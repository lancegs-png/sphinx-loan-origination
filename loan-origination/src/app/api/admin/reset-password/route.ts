import { secretOk } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { resetTempPassword } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops-only: reset a user's password to a fresh one-time temp password, found by email or
 * userId. The app sends no email, so the response carries the temp password to hand over
 * once. Mirrors the in-app admin "Reset password" action. Service role, gated by
 * SHEETS_SYNC_SECRET.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const email = String(body.email ?? "").trim();
  const userId = String(body.userId ?? "").trim();
  if (!email && !userId) return new Response("Provide email or userId", { status: 400 });

  const res = await resetTempPassword(createServiceRoleClient(), {
    email: email || undefined,
    userId: userId || undefined,
  });
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 404 });

  return Response.json({ ok: true, email: res.email, tempPassword: res.tempPassword });
}
