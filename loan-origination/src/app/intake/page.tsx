import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { IntakeForm } from "@/components/intake-form";

/**
 * Intake entry: the native intake form that opens an Opportunity. Lending team enter deals
 * here; brokers use the same form in the broker portal (submitted and attributed to them).
 */
export default async function IntakePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const isLender = !!session.profile?.lender_user_type;
  const isBroker = session.profile?.external_type === "broker";
  if (!isLender && !isBroker) redirect("/");

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <div className="p-6">
        <IntakeForm broker={isBroker} />
      </div>
    </AppShell>
  );
}
