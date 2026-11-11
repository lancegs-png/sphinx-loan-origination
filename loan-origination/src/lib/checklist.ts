import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { ChecklistItem, LoanDocument } from "@/lib/types";

/**
 * Create a loan's checklist from its program's checklist on first access — so the
 * Documents tab is populated (and borrowers can upload) from Intake onward, not only
 * once the loan reaches Processing. Idempotent: no-ops if the checklist already exists.
 */
async function ensureLoanChecklist(loanId: string, programId: string): Promise<void> {
  const admin = createServiceRoleClient();
  const { count } = await admin
    .from("loan_checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("loan_id", loanId);
  if ((count ?? 0) > 0) return;

  const { data: items } = await admin
    .from("program_checklist_items")
    .select("document_type_id")
    .eq("program_id", programId);
  if (!items?.length) return;

  const rows = items.map((i) => ({
    loan_id: loanId,
    document_type_id: i.document_type_id,
    status: "outstanding",
  }));
  await admin
    .from("loan_checklist_items")
    .upsert(rows, { onConflict: "loan_id,document_type_id", ignoreDuplicates: true });
}

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
): Promise<ChecklistItem[]> {
  // Populate the checklist from the program on first view (idempotent), so documents
  // are available for upload starting at Intake.
  if (programId) await ensureLoanChecklist(loanId, programId);

  const { data: items } = await client
    .from("loan_checklist_items")
    .select("id,document_type_id,status,notes")
    .eq("loan_id", loanId);
  if (!items?.length) return [];

  const docIds = items.map((i) => i.document_type_id);
  const [{ data: docs }, { data: pci }] = await Promise.all([
    client.from("document_types").select("id,name,default_review_rules").in("id", docIds),
    programId
      ? client
          .from("program_checklist_items")
          .select("document_type_id,category,assignee,sort")
          .eq("program_id", programId)
      : Promise.resolve({ data: [] as { document_type_id: string; category: string | null; assignee: string; sort: number }[] }),
  ]);
  const docMap = Object.fromEntries((docs ?? []).map((d) => [d.id, d]));
  const pciMap = Object.fromEntries((pci ?? []).map((p) => [p.document_type_id, p]));

  return items
    .map((i) => ({
      id: i.id,
      documentTypeId: i.document_type_id,
      name: docMap[i.document_type_id]?.name ?? "—",
      category: pciMap[i.document_type_id]?.category ?? null,
      assignee: pciMap[i.document_type_id]?.assignee ?? "borrower",
      guidance: docMap[i.document_type_id]?.default_review_rules ?? null,
      status: i.status,
      notes: i.notes,
    }))
    .sort((a, b) => (pciMap[a.documentTypeId]?.sort ?? 0) - (pciMap[b.documentTypeId]?.sort ?? 0));
}
