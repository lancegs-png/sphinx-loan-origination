import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * SERVICE-ROLE client — BYPASSES Row-Level Security.
 *
 * HARD RULE (design §5.1): use ONLY in trusted, non-conversational background jobs
 * (e.g. Drive reconciliation, loan-number allocation, system audit writes).
 * NEVER use this in the request/answer path, in a page/route that serves a user,
 * or for AI retrieval — doing so would re-open every cross-borrower / internal-notes
 * leak path that RLS is there to close. For anything user-facing, use
 * `src/lib/supabase/server.ts` (user-scoped) instead.
 */
export function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
