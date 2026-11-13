import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { recomputeLoan } from "@/lib/calc";
import { loadFieldValues } from "@/lib/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ops-only: recompute calculated fields from current inputs and persist them, for one loan
 * (loanNumber) or every loan (all: true). Use after a calc-rule change to refresh stored
 * values. Returns each loan's key escrow/reserve figures so the result can be verified.
 * Service role, gated by SHEETS_SYNC_SECRET.
 */
function secretOk(given: string): boolean {
  const expected = process.env.SHEETS_SYNC_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const REPORT_KEYS = [
  "principal_and_interest",
  "monthly_piti",
  "reserve_amount",
  "insurance_impound",
  "tax_impound",
  "net_wire",
] as const;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const admin = createServiceRoleClient();
  const all = body.all === true;
  const ref = String(body.loanNumber ?? body.opportunityNumber ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!all && !ref) return new Response("Provide loanNumber or all:true", { status: 400 });

  // Build the target set.
  let targets: { id: string; loan_number: string | null; opportunity_number: string | null }[] = [];
  if (all) {
    const { data, error } = await admin
      .from("loans")
      .select("id,loan_number,opportunity_number")
      .order("created_at", { ascending: true });
    if (error) return new Response(error.message, { status: 500 });
    targets = data ?? [];
  } else {
    const { data } = await admin
      .from("loans")
      .select("id,loan_number,opportunity_number")
      .or(`loan_number.eq.${ref},opportunity_number.eq.${ref}`)
      .maybeSingle();
    if (!data) return Response.json({ ok: false, error: "loan not found" }, { status: 404 });
    targets = [data];
  }

  const results: Record<string, unknown>[] = [];
  for (const t of targets) {
    const entry: Record<string, unknown> = { loan: t.loan_number ?? t.opportunity_number };
    try {
      await recomputeLoan(t.id);
      const fv = await loadFieldValues(admin, t.id);
      for (const k of REPORT_KEYS) entry[k] = fv[k]?.current ?? null;
      entry.ok = true;
    } catch (e) {
      entry.ok = false;
      entry.error = e instanceof Error ? e.message : "recompute failed";
    }
    results.push(entry);
  }

  return Response.json({
    ok: results.every((r) => r.ok),
    count: results.length,
    recomputed: results.filter((r) => r.ok).length,
    loans: results,
  });
}
