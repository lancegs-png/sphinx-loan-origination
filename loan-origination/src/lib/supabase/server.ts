import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * User-scoped server client. Carries the caller's session cookie and the ANON key,
 * so Postgres RLS applies to every query. This is the DEFAULT for all data access,
 * including (later) the AI retrieval path. Hard rule — design §5.1.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware refreshes the session.
          }
        },
      },
    },
  );
}
