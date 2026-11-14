import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of the ops shared secret (SHEETS_SYNC_SECRET) that gates every
 * /api/admin/* route. Shared so the auth check lives in one place.
 */
export function secretOk(given: string): boolean {
  const expected = process.env.SHEETS_SYNC_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
