import { timingSafeEqual } from "node:crypto";
import { applySheetEdit } from "@/lib/google/sheet-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound webhook for live sheet -> app sync. The dashboard's Apps Script onEdit trigger
 * POSTs one human cell edit here; we authenticate it with a shared secret and hand it to
 * applySheetEdit (which enforces input-only, last-writer-wins, and ignore-blanks). Not a
 * user-scoped route — it runs as the service role, so the shared secret is the only gate.
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

  const { sheetId, tab, cell, value, editedAt } = body;
  if (!sheetId || !tab || !cell || typeof value === "undefined") {
    return new Response("Missing fields", { status: 400 });
  }

  try {
    const result = await applySheetEdit({
      sheetId: String(sheetId),
      tab: String(tab),
      cell: String(cell),
      value: String(value),
      editedAt: String(editedAt ?? new Date().toISOString()),
    });
    return Response.json(result);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "error", { status: 500 });
  }
}
