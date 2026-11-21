import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { getMyBrokerIntakeLink } from "@/app/actions";
import { BrokerShareLink } from "@/components/broker-share-link";

/**
 * Broker portal: the broker's shareable intake link. Finds or creates the broker's personal
 * intake_link (service role) and shows the full /apply/<token> URL to copy. Brokers only.
 */
export default async function ShareIntakePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.external_type !== "broker") redirect("/");

  const res = await getMyBrokerIntakeLink();

  // Build the absolute link from request headers (no site-url env is configured).
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = host ? `${proto}://${host}` : "";
  const url = res.ok ? `${origin}/apply/${res.token}` : null;

  return (
    <AppShell email={session.profile?.email ?? ""} nav={navFor(session.profile)}>
      <div className="p-6">
        <BrokerShareLink url={url} error={res.ok ? null : res.error} />
      </div>
    </AppShell>
  );
}
