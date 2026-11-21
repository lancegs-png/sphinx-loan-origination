import { secretOk } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { invalidateFieldDefs } from "@/lib/field-defs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ops-only: upsert the field dictionary from the Loan Data Dictionary sheet. Mirrors the local
 * seed script's write, but runs server-side with the live service role (the local key is revoked).
 * Idempotent on `key` (merge-duplicates): only the columns present in each row are written, so
 * `broker_visible` and any column omitted here survive on existing rows. Service role, gated by
 * SHEETS_SYNC_SECRET.
 *   { secret, rows: [{ key, label, section, type, options, lender_only, ... }] } -> { ok, upserted }
 */

const ALLOWED_TYPES = new Set(["text", "number", "currency", "percent", "date", "select", "email", "phone"]);
// Columns the dictionary importer may write. Any other key on a row is dropped, so a stray column
// from the sheet can never overwrite data the importer isn't meant to own (e.g. broker_visible).
const COLUMNS = new Set([
  "key", "label", "section", "type", "options", "lender_only", "verifiable",
  "repeat_group", "programs", "required_stage", "source", "calc_key", "sort",
]);

type Row = Record<string, unknown>;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const rawRows = Array.isArray(body.rows) ? (body.rows as Row[]) : null;
  if (!rawRows || rawRows.length === 0) return new Response("rows must be a non-empty array", { status: 400 });

  const rows: Row[] = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== "object") return new Response("each row must be an object", { status: 400 });
    const key = String(raw.key ?? "").trim();
    if (!key) return new Response("each row needs a non-empty key", { status: 400 });
    if (raw.type !== undefined && !ALLOWED_TYPES.has(String(raw.type))) {
      return new Response(`${key}: unknown type "${String(raw.type)}"`, { status: 400 });
    }
    const row: Row = {};
    for (const [k, v] of Object.entries(raw)) if (COLUMNS.has(k)) row[k] = v;
    row.key = key;
    rows.push(row);
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("field_definitions").upsert(rows, { onConflict: "key" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  invalidateFieldDefs(); // drop the in-memory dictionary cache so changes are read immediately
  return Response.json({ ok: true, upserted: rows.length });
}
