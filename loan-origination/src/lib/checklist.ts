import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
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
): Promise<ChecklistItem[]> {
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
