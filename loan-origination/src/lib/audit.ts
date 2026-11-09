import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityEvent } from "@/lib/activity";

export type { ActivityEvent } from "@/lib/activity";
export { describeEvent, actorName } from "@/lib/activity";

/**
 * Record a loan activity event. Writes go through the service role (the audit_events
 * RLS only grants SELECT to clients). Logging never throws into the primary action —
 * a failed log must not fail the thing being logged.
 */
export async function logEvent(
  admin: SupabaseClient,
  e: {
    loanId: string;
    actorId?: string | null;
    actorKind?: "human" | "ai" | "system";
    eventType: string;
    isInternal?: boolean;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("audit_events").insert({
      loan_id: e.loanId,
      actor_id: e.actorId ?? null,
      actor_kind: e.actorKind ?? "human",
      event_type: e.eventType,
      is_internal: e.isInternal ?? false,
      payload: e.payload ?? null,
    });
  } catch {
    /* best-effort: never break the action being audited */
  }
}

/** Load a loan's activity events (newest first), actor joined. RLS-filtered. */
export async function loadLoanActivity(
  client: SupabaseClient,
  loanId: string,
): Promise<ActivityEvent[]> {
  const { data } = await client
    .from("audit_events")
    .select("id,event_type,actor_kind,is_internal,payload,created_at,actor:actor_id(full_name,email)")
    .eq("loan_id", loanId)
    .order("created_at", { ascending: false });
  return (data as ActivityEvent[] | null) ?? [];
}
