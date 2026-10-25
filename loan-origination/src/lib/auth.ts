import "server-only";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

/** Returns the current auth user + their profile, or null if not signed in. */
export async function getSessionProfile(): Promise<{
  userId: string;
  profile: Profile | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { userId: user.id, profile: (profile as Profile) ?? null };
}
