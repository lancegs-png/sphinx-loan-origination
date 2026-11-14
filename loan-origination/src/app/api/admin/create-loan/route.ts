import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { openDeal } from "@/lib/loans/open-deal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ops-only: open a new loan in the app (the record addLoan creates, minus the chat intake
 * session) with a property address, optional guarantor, and the deal's Drive folder + DSCR
 * dashboard linked. Optionally assigns the permanent SPHX number right away. Service role,
 * gated solely by SHEETS_SYNC_SECRET — same trust model as the other /api/admin routes.
 *
 * Shares all creation logic with the in-app "New loan" action via openDeal(); the open-loan
 * script pre-creates the Drive folder/dashboard and passes their ids here.
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

  const address = String(body.address ?? "").trim();
  if (!address) return new Response("Missing address", { status: 400 });

  try {
    const result = await openDeal(createServiceRoleClient(), {
      address,
      guarantorFirst: String(body.guarantorFirst ?? ""),
      guarantorLast: String(body.guarantorLast ?? ""),
      driveFolderId: String(body.driveFolderId ?? "").trim() || null,
      sheetId: String(body.sheetId ?? "").trim() || null,
      assignNumber: body.assignNumber === true,
      loanNumber: String(body.loanNumber ?? ""),
      stage: String(body.stage ?? "").trim() || undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "create failed", { status: 500 });
  }
}
