import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { ensureProgramAndChecklist } from "@/lib/checklist-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops-only: set a loan's program_id (from its loan_type) and build its document checklist,
 * for loans opened without one (e.g. before create-loan seeded it). Idempotent. Service
 * role, gated by SHEETS_SYNC_SECRET.
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

  const ref = String(body.loanNumber ?? body.opportunityNumber ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!ref) return new Response("Missing loanNumber", { status: 400 });

  const admin = createServiceRoleClient();
  const { data: loan, error } = await admin
    .from("loans")
    .select("id,loan_number,opportunity_number")
    .or(`loan_number.eq.${ref},opportunity_number.eq.${ref}`)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!loan) return Response.json({ ok: false, error: "loan not found" }, { status: 404 });

  const result = await ensureProgramAndChecklist(admin, loan.id);
  return Response.json({
    ok: true,
    loan: loan.loan_number ?? loan.opportunity_number,
    program_id: result.programId,
    checklist_items: result.checklistItems,
  });
}
