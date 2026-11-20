import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { IntakeForm } from "@/components/intake-form";

/**
 * Manual intake entry (Phase 1): lending-team-only page that opens an Opportunity from the
 * native intake form. The public, white-label version of this form lands in Phase 3.
 */
export default async function IntakePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!session.profile?.lender_user_type) redirect("/");

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <div className="p-6">
        <IntakeForm />
      </div>
    </AppShell>
  );
}
