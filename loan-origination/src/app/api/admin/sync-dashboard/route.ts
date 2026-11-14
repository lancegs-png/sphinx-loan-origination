import { secretOk } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { syncLoanToDashboard } from "@/lib/google/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ops-only: run the app's dashboard sync for a loan — resolves/links the deal's Drive
 * folder (by street) and its DSCR dashboard, then writes the loan's field values into it.
 * Use after creating a loan's folder so the dashboard is linked + populated. Service role,
 * gated by SHEETS_SYNC_SECRET.
 */

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const ref = String(body.loanNumber ?? body.opportunityNumber ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!ref) return new Response("Missing loanNumber", { status: 400 });

  const admin = createServiceRoleClient();
  const { data: loan } = await admin
    .from("loans")
    .select("id,loan_number,opportunity_number")
    .or(`loan_number.eq.${ref},opportunity_number.eq.${ref}`)
    .maybeSingle();
  if (!loan) return Response.json({ ok: false, error: "loan not found" }, { status: 404 });

  try {
    const { url, wrote } = await syncLoanToDashboard(loan.id);
    return Response.json({ ok: true, loan: loan.loan_number ?? loan.opportunity_number, dashboard: url, wrote });
  } catch (e) {
    return Response.json(
      { ok: false, loan: loan.loan_number ?? loan.opportunity_number, error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 },
    );
  }
}
