import { secretOk } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops-only: re-point a loan's dashboard (loans.sheet_id) at a specific Google Sheet. Used to
 * fix loans that were wired to the wrong (auto-created duplicate) dashboard. Runs as the
 * service role, gated solely by the shared SHEETS_SYNC_SECRET — same trust model as the
 * inbound /api/sheets/edit webhook.
 */

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const loanNumber = String(body.loanNumber ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const sheetId = String(body.sheetId ?? "").trim();
  if (!loanNumber || !sheetId) return new Response("Missing loanNumber/sheetId", { status: 400 });

  const admin = createServiceRoleClient();
  const { data: loan, error: findErr } = await admin
    .from("loans")
    .select("id,loan_number,opportunity_number,sheet_id")
    .or(`loan_number.eq.${loanNumber},opportunity_number.eq.${loanNumber}`)
    .maybeSingle();
  if (findErr) return new Response(findErr.message, { status: 500 });
  if (!loan) return Response.json({ ok: false, error: "loan not found" }, { status: 404 });

  const previous = loan.sheet_id ?? null;
  const { error: updErr } = await admin.from("loans").update({ sheet_id: sheetId }).eq("id", loan.id);
  if (updErr) return new Response(updErr.message, { status: 500 });

  return Response.json({
    ok: true,
    loan: loan.loan_number ?? loan.opportunity_number,
    previous,
    sheet_id: sheetId,
  });
}
