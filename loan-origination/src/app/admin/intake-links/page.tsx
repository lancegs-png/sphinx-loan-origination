import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { IntakeLinksAdmin } from "@/components/intake-links-admin";
import type { IntakeLink } from "@/lib/intake/links";

/** Settings → Intake Links: manage the shareable public intake links (Phase 3). Admin only. */
export default async function IntakeLinksPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const [{ data: links }, { data: subs }, { data: users }] = await Promise.all([
    supabase
      .from("intake_links")
      .select("id,token,label,owner_type,owner_user_id,owner_name,owner_email,branding,active,created_at")
      .order("created_at", { ascending: false }),
    supabase.from("intake_submissions").select("link_id"),
    supabase.from("profiles").select("id,full_name,email").eq("is_lending_team", true).order("full_name"),
  ]);

  const counts: Record<string, number> = {};
  for (const s of subs ?? []) {
    const k = (s as { link_id: string | null }).link_id;
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }

  const nav = navFor(session.profile);
  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
        <IntakeLinksAdmin
          links={(links ?? []) as IntakeLink[]}
          counts={counts}
          users={(users ?? []) as { id: string; full_name: string | null; email: string }[]}
        />
      </main>
    </AppShell>
  );
}
