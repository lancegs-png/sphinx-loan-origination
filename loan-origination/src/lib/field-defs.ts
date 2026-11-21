import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/**
 * field_definitions is a small (~140-row), rarely-changing dictionary that several service-role
 * write paths (the sheet push on every field save, the sheet reconcile on the fallback poll) read
 * in full each time. Cache it in memory for a short TTL per server instance, and invalidate when an
 * admin edits a field definition, so those paths don't re-read the whole table constantly.
 *
 * This is only used by service-role paths (the full dictionary); the user-scoped loan page keeps
 * its own RLS-filtered read.
 */
export type FieldDefRow = {
  key: string;
  type: string;
  source: string | null;
  options: string[] | null;
};

const TTL_MS = 60_000;
let cache: { at: number; rows: FieldDefRow[] } | null = null;

export async function loadFieldDefs(): Promise<FieldDefRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const admin = createServiceRoleClient();
  const { data } = await admin.from("field_definitions").select("key,type,source,options");
  const rows = (data as FieldDefRow[]) ?? [];
  cache = { at: Date.now(), rows };
  return rows;
}

/** Drop the cache so the next read reflects an admin's field-definition change immediately. */
export function invalidateFieldDefs(): void {
  cache = null;
}
