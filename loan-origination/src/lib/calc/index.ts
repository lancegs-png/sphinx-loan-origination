import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { commonCalcs, dscrCalcs, rtlCalcs, type Get } from "./formulas";

/**
 * Recompute every calculated field for a loan from its current field values and
 * write the results (read-only) via the apply_calc_values RPC. Program-aware:
 * DSCR vs RTL. Safe to call after any field change.
 */
export async function recomputeLoan(loanId: string): Promise<void> {
  const admin = createServiceRoleClient();
  const [{ data: loan }, fv] = await Promise.all([
    admin.from("loans").select("loan_type").eq("id", loanId).single(),
    loadFieldValues(admin, loanId),
  ]);
  const get: Get = (k) => fv[k]?.current;

  const program = String(get("loan_program") ?? loan?.loan_type ?? "").toLowerCase();

  const out: Record<string, unknown> = { ...commonCalcs(get) };
  if (program.includes("rtl")) Object.assign(out, rtlCalcs(get));
  else Object.assign(out, dscrCalcs(get)); // default to DSCR

  // undefined -> null so cleared inputs clear their derived values.
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(out)) payload[k] = v === undefined ? null : v;

  await admin.rpc("apply_calc_values", { p_loan_id: loanId, p_values: payload });

  // Keep the denormalized loans.* columns (read by the deal title, pipeline table +
  // volume summary, and document/data paths) in sync with the field model, which is
  // the source of truth. Each is written only when there's a value, so clearing a
  // field never blanks the column.
  const colPatch: Record<string, unknown> = {};

  const addr = out.property_address; // calculated full address (street/city/state/zip)
  if (typeof addr === "string" && addr.trim()) colPatch.property_address = addr.trim();

  const amount = out.loan_amount; // calculated loan amount
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
    colPatch.loan_amount = amount;
  }

  const closing = get("closing_date"); // manual field
  if (typeof closing === "string" && closing.trim()) colPatch.closing_date = closing.trim();

  const entity = get("borrower_entity"); // the borrowing entity
  if (typeof entity === "string" && entity.trim()) colPatch.borrower_name = entity.trim();

  if (Object.keys(colPatch).length > 0) {
    await admin.from("loans").update(colPatch).eq("id", loanId);
  }
}
