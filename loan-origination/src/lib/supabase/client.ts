'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Browser client (ANON key + session). RLS applies. Used for realtime subscriptions and client reads. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
