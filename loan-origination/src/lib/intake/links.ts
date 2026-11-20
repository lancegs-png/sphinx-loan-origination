import "server-only";
import { randomBytes } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type IntakeLinkOwnerType = "sphinx_originator" | "broker" | "referral_partner";
export type IntakeLinkBranding = "sphinx" | "white_label";

export type IntakeLink = {
  id: string;
  token: string;
  label: string;
  owner_type: IntakeLinkOwnerType;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  branding: IntakeLinkBranding;
  active: boolean;
  created_at?: string;
};

/** A short, URL-safe token for a shareable link. */
export function newLinkToken(): string {
  return randomBytes(12).toString("base64url"); // ~16 chars, URL-safe
}

/** Look up an active link by token. Used by the public /apply route (no auth → service role). */
export async function getActiveLink(token: string): Promise<IntakeLink | null> {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from("intake_links")
    .select("id,token,label,owner_type,owner_user_id,owner_name,owner_email,branding,active")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  return (data as IntakeLink) ?? null;
}

/** Simple abuse guard: too many submissions for this link in the last hour. */
export async function isRateLimited(token: string, maxPerHour = 15): Promise<boolean> {
  const admin = createServiceRoleClient();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin
    .from("intake_submissions")
    .select("id", { count: "exact", head: true })
    .eq("token", token)
    .gte("created_at", since);
  return (count ?? 0) >= maxPerHour;
}

/** Record a submission (for rate limiting, counts, and audit). Best-effort. */
export async function recordSubmission(
  linkId: string,
  token: string,
  loanId: string | null,
  ip: string | null,
): Promise<void> {
  const admin = createServiceRoleClient();
  await admin
    .from("intake_submissions")
    .insert({ link_id: linkId, token, loan_id: loanId, ip })
    .then(() => {}, () => {});
}
