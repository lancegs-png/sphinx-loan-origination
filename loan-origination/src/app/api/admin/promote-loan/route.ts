import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { sheetsConfigured, appendSheetRow } from "@/lib/google/sheets";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors the constant in src/app/actions.ts (signTermSheet).
const LOAN_TRACKER_SHEET_ID =
  process.env.GOOGLE_LOAN_TRACKER_SHEET_ID || "1FLrQZqFAJ7v-8cZeT3EGTPJ_Vut6JLPp_rNSXwEbm4Y";

/**
 * Ops-only: promote an opportunity to a loan when its term sheet was signed OUTSIDE the
 * platform. Does what signTermSheet does, minus the e-signature capture: assigns the
 * permanent SPHX loan number (idempotent via assign_loan_number), records the external
 * signature on custom_fields.term_sheet (no fabricated in-app e-signature / IP), and
 * appends the deal to the org "Loan Number Tracker" sheet. Runs as the service role,
 * gated solely by SHEETS_SYNC_SECRET — same trust model as /api/sheets/edit.
 */
function secretOk(given: string): boolean {
  const expected = process.env.SHEETS_SYNC_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const opp = String(body.opportunityNumber ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!opp) return new Response("Missing opportunityNumber", { status: 400 });

  const admin = createServiceRoleClient();
  const { data: loan, error: findErr } = await admin
    .from("loans")
    .select("id,opportunity_number,loan_number,property_address,custom_fields")
    .eq("opportunity_number", opp)
    .maybeSingle();
  if (findErr) return new Response(findErr.message, { status: 500 });
  if (!loan) return Response.json({ ok: false, error: "opportunity not found" }, { status: 404 });

  // Already a loan? Idempotent — report the existing number and don't double-append.
  const alreadyLoan = !!loan.loan_number;

  // Assign the permanent SPHX number (atomic + idempotent in the DB function).
  const { data: assigned, error: rpcErr } = await admin.rpc("assign_loan_number", {
    p_loan_id: loan.id,
  });
  if (rpcErr) return new Response(rpcErr.message, { status: 500 });
  const loanNumber = (assigned as string | null) ?? loan.loan_number ?? null;
  if (!loanNumber)
    return Response.json({ ok: false, error: "no loan number assigned" }, { status: 500 });

  // Record the external signature — don't fabricate an in-app e-signature or IP.
  const cf = (loan.custom_fields as Record<string, unknown> | null) ?? {};
  const prevTs = (cf.term_sheet as Record<string, unknown> | undefined) ?? {};
  const custom = {
    ...cf,
    term_sheet: { ...prevTs, signed_externally: true, recorded_at: new Date().toISOString() },
  };
  await admin.from("loans").update({ custom_fields: custom }).eq("id", loan.id);

  // Append to the org Loan Tracker only on first promotion (matches signTermSheet).
  let trackerAppended = false;
  if (!alreadyLoan && sheetsConfigured()) {
    try {
      await appendSheetRow(LOAN_TRACKER_SHEET_ID, "Loan Number Tracker", [
        loan.property_address ?? "",
        loanNumber,
      ]);
      trackerAppended = true;
    } catch {
      /* best-effort: never block promotion on a tracker write */
    }
  }

  await logEvent(admin, {
    loanId: loan.id,
    actorKind: "system",
    eventType: "term_sheet_signed",
    payload: { loan_number: loanNumber, signed_externally: true },
  });

  return Response.json({
    ok: true,
    opportunity: loan.opportunity_number,
    loan_number: loanNumber,
    already_loan: alreadyLoan,
    address: loan.property_address ?? null,
    tracker_appended: trackerAppended,
  });
}
