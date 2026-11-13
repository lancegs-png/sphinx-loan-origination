import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ensure a loan has a `program_id` (derived from its loan_type / loan_program key when it
 * isn't set yet) and instantiate its document checklist from that program's required
 * documents. Service-role and idempotent — safe to call repeatedly. Loans opened outside
 * the chat intake (e.g. via /api/admin/create-loan) need this so the Documents tab shows
 * the program's checklist. Returns the resolved program id and the checklist row count.
 */
export async function ensureProgramAndChecklist(
  admin: SupabaseClient,
  loanId: string,
): Promise<{ programId: string | null; checklistItems: number }> {
  const { data: loan } = await admin
    .from("loans")
    .select("program_id,loan_type,loan_program")
    .eq("id", loanId)
    .single();
  if (!loan) return { programId: null, checklistItems: 0 };

  let programId = (loan.program_id as string | null) ?? null;
  if (!programId) {
    // loan_type_key is the lowercase program key (e.g. "dscr", "rtl"); the loans row carries
    // the label in loan_type / loan_program.
    const key = String(loan.loan_type ?? loan.loan_program ?? "").toLowerCase().trim();
    if (key) {
      const { data: prog } = await admin
        .from("loan_programs")
        .select("id")
        .eq("loan_type_key", key)
        .maybeSingle();
      if (prog) {
        programId = prog.id as string;
        await admin.from("loans").update({ program_id: programId }).eq("id", loanId);
      }
    }
  }
  if (!programId) return { programId: null, checklistItems: 0 };

  const { data: items } = await admin
    .from("program_checklist_items")
    .select("document_type_id")
    .eq("program_id", programId);
  if (!items?.length) return { programId, checklistItems: 0 };

  const rows = items.map((i) => ({
    loan_id: loanId,
    document_type_id: i.document_type_id,
    status: "outstanding",
  }));
  await admin
    .from("loan_checklist_items")
    .upsert(rows, { onConflict: "loan_id,document_type_id", ignoreDuplicates: true });
  return { programId, checklistItems: rows.length };
}
