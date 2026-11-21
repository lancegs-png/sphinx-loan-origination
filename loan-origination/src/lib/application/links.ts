import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { newLinkToken } from "@/lib/intake/links";

/**
 * Per-loan borrower-application links. Unlike intake links (which open a NEW loan), these are tied to
 * an EXISTING loan and sent to the borrower after the term sheet is signed. The public
 * /application/<token> route resolves them through the service role (no auth → no RLS access for anon).
 */

export type ApplicationLink = {
  id: string;
  token: string;
  loan_id: string;
  active: boolean;
  completed_at: string | null;
  created_at?: string;
};

/** Look up an active application link by token (public route → service role). */
export async function getActiveApplicationLink(token: string): Promise<ApplicationLink | null> {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from("application_links")
    .select("id,token,loan_id,active,completed_at")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  return (data as ApplicationLink) ?? null;
}

/**
 * Create (or reuse) the active application link for a loan, returning its token. Reuses an existing
 * active, not-yet-completed link so re-sending doesn't invalidate a link already in the borrower's inbox.
 */
export async function ensureApplicationLink(loanId: string, createdBy: string | null): Promise<ApplicationLink> {
  const admin = createServiceRoleClient();
  const { data: existing } = await admin
    .from("application_links")
    .select("id,token,loan_id,active,completed_at")
    .eq("loan_id", loanId)
    .eq("active", true)
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as ApplicationLink;

  const token = newLinkToken();
  const { data, error } = await admin
    .from("application_links")
    .insert({ token, loan_id: loanId, created_by: createdBy })
    .select("id,token,loan_id,active,completed_at")
    .single();
  if (error) throw new Error(`Failed to create application link: ${error.message}`);
  return data as ApplicationLink;
}

/** Simple abuse guard: too many submissions for this link in the last hour. */
export async function isApplicationRateLimited(token: string, maxPerHour = 10): Promise<boolean> {
  const admin = createServiceRoleClient();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin
    .from("application_submissions")
    .select("id", { count: "exact", head: true })
    .eq("token", token)
    .gte("created_at", since);
  return (count ?? 0) >= maxPerHour;
}

/** Record a submission (rate limiting, counts, audit). Best-effort. */
export async function recordApplicationSubmission(
  linkId: string,
  token: string,
  loanId: string | null,
  ip: string | null,
): Promise<void> {
  const admin = createServiceRoleClient();
  await admin
    .from("application_submissions")
    .insert({ link_id: linkId, token, loan_id: loanId, ip })
    .then(() => {}, () => {});
}

/** Mark a link completed once the borrower submits + signs (so it can't be reused). */
export async function markApplicationLinkCompleted(linkId: string): Promise<void> {
  const admin = createServiceRoleClient();
  await admin
    .from("application_links")
    .update({ completed_at: new Date().toISOString(), active: false })
    .eq("id", linkId)
    .then(() => {}, () => {});
}
