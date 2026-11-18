import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A fresh one-time temp password, e.g. "Tmp-a1b2c3d4" + two digits. */
export function generateTempPassword(): string {
  return `Tmp-${Math.random().toString(36).slice(2, 10)}${Math.floor(Math.random() * 90 + 10)}`;
}

export type ResetResult =
  | { ok: true; userId: string; email: string; tempPassword: string }
  | { ok: false; error: string };

/**
 * Reset a user's password to a fresh one-time temp password (service role). The app sends no
 * email, so the caller shows the returned password once to hand over. The user is found by
 * userId when given, else by email (case-insensitive, via profiles). Shared by the in-app
 * admin "Reset password" action and the /api/admin/reset-password ops endpoint.
 */
export async function resetTempPassword(
  admin: SupabaseClient,
  input: { email?: string; userId?: string },
): Promise<ResetResult> {
  let userId = (input.userId ?? "").trim();
  let email = (input.email ?? "").trim();
  if (!userId) {
    if (!email) return { ok: false, error: "Email or userId required." };
    const { data: prof, error } = await admin
      .from("profiles")
      .select("id,email")
      .ilike("email", email)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!prof) return { ok: false, error: "No user with that email." };
    userId = prof.id as string;
    email = (prof.email as string) ?? email;
  }

  const tempPassword = generateTempPassword();
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) return { ok: false, error: error.message };

  return { ok: true, userId, email: email || data.user?.email || "", tempPassword };
}
