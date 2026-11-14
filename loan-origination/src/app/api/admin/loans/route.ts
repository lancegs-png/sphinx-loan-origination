import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops-only loan admin: list every loan, or hard-delete specific loans by id (cascades to
 * the loan's field values, documents metadata, checklist, participants, messages and audit
 * events — it does NOT remove the Storage blobs or Drive folder). Deletion is BY EXPLICIT
 * ID only (never "delete all except"), so the caller confirms the exact set first. Service
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

  const admin = createServiceRoleClient();
  const action = String(body.action ?? "list");

  if (action === "list") {
    const { data, error } = await admin
      .from("loans")
      .select("id,loan_number,opportunity_number,property_address,borrower_name,stage,status,created_at")
      .order("created_at", { ascending: true });
    if (error) return new Response(error.message, { status: 500 });
    return Response.json({ ok: true, count: data?.length ?? 0, loans: data ?? [] });
  }

  if (action === "archive" || action === "unarchive") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (ids.length === 0) return new Response("No ids provided", { status: 400 });
    const status = action === "archive" ? "archived" : "active";
    const { data: updated, error } = await admin
      .from("loans")
      .update({ status })
      .in("id", ids)
      .select("id,loan_number,opportunity_number,property_address,status");
    if (error) return new Response(error.message, { status: 500 });
    return Response.json({ ok: true, updated: updated?.length ?? 0, status, loans: updated ?? [] });
  }

  if (action === "field-scan") {
    // Return each loan's current value for one field (verified ?? initial), idx 1, with the
    // loan number — for auditing/backfilling a specific field across the book.
    const fieldKey = String(body.fieldKey ?? "").trim();
    if (!fieldKey) return new Response("Missing fieldKey", { status: 400 });
    const [{ data: fvs, error }, { data: loans }] = await Promise.all([
      admin.from("loan_field_values").select("loan_id,initial_value,verified_value").eq("field_key", fieldKey).eq("idx", 1),
      admin.from("loans").select("id,loan_number,opportunity_number"),
    ]);
    if (error) return new Response(error.message, { status: 500 });
    const refById = new Map((loans ?? []).map((l) => [l.id, l.loan_number ?? l.opportunity_number]));
    const rows = (fvs ?? [])
      .map((r) => ({ loan_id: r.loan_id, ref: refById.get(r.loan_id) ?? null, value: r.verified_value ?? r.initial_value ?? null }))
      .filter((r) => r.value != null && r.value !== "");
    return Response.json({ ok: true, field: fieldKey, count: rows.length, rows });
  }

  if (action === "delete") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (ids.length === 0) return new Response("No ids provided", { status: 400 });
    // Return what we're about to delete (for the audit trail in the response).
    const { data: targets } = await admin
      .from("loans")
      .select("id,loan_number,opportunity_number,property_address")
      .in("id", ids);
    const { error } = await admin.from("loans").delete().in("id", ids);
    if (error) return new Response(error.message, { status: 500 });
    return Response.json({ ok: true, deleted: targets?.length ?? 0, loans: targets ?? [] });
  }

  return new Response("Unknown action", { status: 400 });
}
