import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { UsersRolesEditor, type UserRow } from "@/components/users-roles-editor";

/** User ids currently banned in auth (deactivated). Best-effort — service role. */
async function loadDeactivatedUserIds(): Promise<Set<string>> {
  const deactivated = new Set<string>();
  try {
    const admin = createServiceRoleClient();
    const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const now = Date.now();
    for (const u of authList?.users ?? []) {
      const bannedUntil = (u as { banned_until?: string | null }).banned_until;
      if (bannedUntil && new Date(bannedUntil).getTime() > now) deactivated.add(u.id);
    }
  } catch {
    /* if the auth listing fails, everyone shows as active */
  }
  return deactivated;
}

export default async function UsersPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name,is_lending_team,lender_user_type,external_type")
    .order("created_at");

  // Deactivated (banned) state lives in auth, not profiles — read it with the service role.
  const deactivated = await loadDeactivatedUserIds();
  const rows: UserRow[] = ((data as Omit<UserRow, "deactivated">[]) ?? []).map((r) => ({
    ...r,
    deactivated: deactivated.has(r.id),
  }));

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <UsersRolesEditor initial={rows} currentUserId={session.userId} />
    </AppShell>
  );
}
