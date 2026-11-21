import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { ChecklistItem, LoanDocument } from "@/lib/types";

/** Load a loan's uploaded documents (newest last), for listing under each checklist item. */
export async function loadLoanDocuments(
  client: SupabaseClient,
  loanId: string,
): Promise<LoanDocument[]> {
  const { data } = await client
    .from("loan_documents")
    .select("id,checklist_item_id,file_name,content_type,size_bytes,drive_web_link,created_at")
    .eq("loan_id", loanId)
    .order("created_at", { ascending: true });
  return (data as LoanDocument[]) ?? [];
}

/** Load a loan's checklist, joined with document names + program category/assignee. */
export async function loadLoanChecklist(
  client: SupabaseClient,
  loanId: string,
  programId: string | null,
  isLender: boolean,
): Promise<ChecklistItem[]> {
  type Pci = {
    document_type_id: string;
    category: string | null;
    assignee: string;
    visibility: string;
    sort: number;
  };

  // One read of each table (not two): the program checklist both drives which documents a loan
  // should have and supplies category/assignee/visibility/sort for the rows.
  const [{ data: itemRows }, { data: pciData }] = await Promise.all([
    client.from("loan_checklist_items").select("id,document_type_id,status,notes").eq("loan_id", loanId),
    programId
      ? client
          .from("program_checklist_items")
          .select("document_type_id,category,assignee,visibility,sort")
          .eq("program_id", programId)
      : Promise.resolve({ data: [] as Pci[] }),
  ]);

  let items = itemRows ?? [];
  const pci = (pciData as Pci[] | null) ?? [];

  // Materialize any missing template documents on first view (idempotent), so the Documents tab
  // is populated from Intake onward. Writes — and re-reads — only when something is missing; the
  // common case (every template document present) does neither.
  if (programId && pci.length) {
    const have = new Set(items.map((i) => i.document_type_id as string));
    const missing = pci.filter((p) => !have.has(p.document_type_id));
    if (missing.length) {
      const admin = createServiceRoleClient();
      await admin.from("loan_checklist_items").upsert(
        missing.map((p) => ({ loan_id: loanId, document_type_id: p.document_type_id, status: "outstanding" })),
        { onConflict: "loan_id,document_type_id", ignoreDuplicates: true },
      );
      const { data: refreshed } = await client
        .from("loan_checklist_items")
        .select("id,document_type_id,status,notes")
        .eq("loan_id", loanId);
      items = refreshed ?? items;
    }
  }
  if (!items.length) return [];

  const docIds = items.map((i) => i.document_type_id);
  const { data: docs } = await client
    .from("document_types")
    .select("id,name,default_review_rules")
    .in("id", docIds);
  const docMap = Object.fromEntries((docs ?? []).map((d) => [d.id, d]));
  const pciMap = Object.fromEntries(pci.map((p) => [p.document_type_id, p]));

  return items
    .map((i) => ({
      id: i.id,
      documentTypeId: i.document_type_id,
      name: docMap[i.document_type_id]?.name ?? "—",
      category: pciMap[i.document_type_id]?.category ?? null,
      assignee: pciMap[i.document_type_id]?.assignee ?? "borrower",
      visibility: pciMap[i.document_type_id]?.visibility ?? "all",
      guidance: docMap[i.document_type_id]?.default_review_rules ?? null,
      status: i.status,
      notes: i.notes,
    }))
    // Lender-only documents are hidden from borrowers / brokers.
    .filter((it) => isLender || it.visibility !== "lender_only")
    .sort((a, b) => (pciMap[a.documentTypeId]?.sort ?? 0) - (pciMap[b.documentTypeId]?.sort ?? 0));
}
