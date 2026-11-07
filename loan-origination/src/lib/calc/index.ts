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
}
