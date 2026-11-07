import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell, type NavItem } from "@/components/app-shell";
import { UsersRolesEditor, type UserRow } from "@/components/users-roles-editor";

export default async function UsersPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name,is_lending_team,lender_user_type,external_type")
    .order("created_at");

  const nav: NavItem[] = [
    { href: "/", label: "Pipeline", icon: "pipeline", match: "exact" },
    { href: "/admin", label: "Settings", icon: "settings", match: "prefix" },
  ];

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <UsersRolesEditor initial={(data as UserRow[]) ?? []} currentUserId={session.userId} />
    </AppShell>
  );
}
