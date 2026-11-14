import { secretOk } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops-only: read or patch a field definition's select options. For fixing dictionary typos
 * (e.g. a missing close paren on a prepay option). Service role, gated by SHEETS_SYNC_SECRET.
 *   { action: "get", key }                 -> { key, label, type, options }
 *   { action: "set-options", key, options } -> replaces the options array
 */

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const admin = createServiceRoleClient();
  const action = String(body.action ?? "get");
  const key = String(body.key ?? "").trim();
  if (!key) return new Response("Missing key", { status: 400 });

  if (action === "get") {
    const { data, error } = await admin
      .from("field_definitions")
      .select("key,label,type,section,options")
      .eq("key", key)
      .maybeSingle();
    if (error) return new Response(error.message, { status: 500 });
    if (!data) return Response.json({ ok: false, error: "field not found" }, { status: 404 });
    return Response.json({ ok: true, field: data });
  }

  if (action === "set-options") {
    const options = Array.isArray(body.options) ? body.options.map(String) : null;
    if (!options) return new Response("options must be an array", { status: 400 });
    const { data, error } = await admin
      .from("field_definitions")
      .update({ options })
      .eq("key", key)
      .select("key,options")
      .maybeSingle();
    if (error) return new Response(error.message, { status: 500 });
    if (!data) return Response.json({ ok: false, error: "field not found" }, { status: 404 });
    return Response.json({ ok: true, field: data });
  }

  return new Response("Unknown action", { status: 400 });
}
