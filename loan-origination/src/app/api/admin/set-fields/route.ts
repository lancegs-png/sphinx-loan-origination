import { secretOk } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { upsertFieldValue, loadFieldValues } from "@/lib/fields";
import { recomputeLoan } from "@/lib/calc";
import { syncLoanToDashboard } from "@/lib/google/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ops-only: set one or more field values on a loan (initial values), then recompute and
 * sync the linked dashboard. For data migrations / backfills. Keys may carry a repeat index
 * as "key#2". Service role, gated by SHEETS_SYNC_SECRET.
 */

const REPORT_KEYS = ["loan_amount", "principal_and_interest", "monthly_piti", "dscr", "reserve_amount", "insurance_impound", "tax_impound"] as const;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const ref = String(body.loanNumber ?? body.opportunityNumber ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const fields = (body.fields && typeof body.fields === "object" ? body.fields : null) as Record<string, unknown> | null;
  if (!ref) return new Response("Missing loanNumber", { status: 400 });
  if (!fields || Object.keys(fields).length === 0) return new Response("No fields provided", { status: 400 });

  const admin = createServiceRoleClient();
  const { data: loan } = await admin
    .from("loans")
    .select("id,loan_number,opportunity_number")
    .or(`loan_number.eq.${ref},opportunity_number.eq.${ref}`)
    .maybeSingle();
  if (!loan) return Response.json({ ok: false, error: "loan not found" }, { status: 404 });

  // kind controls which value column(s) to write. Default "initial"; "both" also writes
  // verified_value so the result is authoritative (current = verified ?? initial) — used
  // when correcting a value that an existing verified_value would otherwise shadow.
  const kind = String(body.kind ?? "initial");
  const writeInitial = kind === "initial" || kind === "both";
  const writeVerified = kind === "verified" || kind === "both";

  const applied: string[] = [];
  for (const [rawKey, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const [key, idxStr] = rawKey.split("#");
    const idx = idxStr ? Number(idxStr) : 1;
    if (writeInitial) {
      const { error } = await upsertFieldValue(admin, { loanId: loan.id, key, idx, valueKind: "initial", value });
      if (error) return Response.json({ ok: false, error: `${rawKey}: ${error.message}` }, { status: 500 });
    }
    if (writeVerified) {
      const { error } = await upsertFieldValue(admin, { loanId: loan.id, key, idx, valueKind: "verified", value });
      if (error) return Response.json({ ok: false, error: `${rawKey} (verified): ${error.message}` }, { status: 500 });
    }
    applied.push(rawKey);
  }

  await recomputeLoan(loan.id);
  let dashboard: string | null = null;
  try {
    dashboard = (await syncLoanToDashboard(loan.id)).url;
  } catch {
    /* best-effort */
  }

  const fv = await loadFieldValues(admin, loan.id);
  const calc: Record<string, unknown> = {};
  for (const k of REPORT_KEYS) calc[k] = fv[k]?.current ?? null;

  return Response.json({ ok: true, loan: loan.loan_number ?? loan.opportunity_number, applied: applied.length, dashboard, calc });
}
