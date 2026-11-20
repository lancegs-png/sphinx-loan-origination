import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { loadEntities, loadGuarantors } from "@/lib/parties";
import { PartiesManager } from "@/components/parties-manager";

export default async function GuarantorsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!session.profile?.is_lending_team) redirect("/");

  const sb = await createClient();
  const [guarantors, entities] = await Promise.all([loadGuarantors(sb), loadEntities(sb)]);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={navFor(session.profile)}>
      <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
        <header className="mb-6">
          <h1 className="text-[1.75rem] font-bold text-fg">Guarantors &amp; Entities</h1>
          <p className="mt-1 text-sm text-muted">
            Reusable records — create them here, then select them when opening a new loan to auto-fill its details.
          </p>
        </header>
        <PartiesManager guarantors={guarantors} entities={entities} />
      </main>
    </AppShell>
  );
}
