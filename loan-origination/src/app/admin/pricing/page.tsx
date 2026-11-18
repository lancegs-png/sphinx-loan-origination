import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { PricingSizerUpload } from "@/components/pricing-sizer-upload";
import type { InvestorFamily } from "@/lib/pricing/general";

type PublishedMeta = { effective: string | null; at: string; file: string | null };

export default async function DscrPricingPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: program } = await supabase
    .from("loan_programs")
    .select("id")
    .eq("loan_type_key", "dscr")
    .maybeSingle();

  let published: Partial<Record<InvestorFamily, PublishedMeta>> = {};
  if (program?.id) {
    const { data: pricing } = await supabase
      .from("program_pricing")
      .select("model")
      .eq("program_id", program.id)
      .maybeSingle();
    const model = (pricing?.model as Record<string, unknown> | null) ?? {};
    published = (model.engines_published as Partial<Record<InvestorFamily, PublishedMeta>>) ?? {};
  }

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <main className="mx-auto max-w-4xl px-6 py-9 lg:px-10">
        <Link href="/admin" className="text-sm text-muted transition-colors hover:text-fg">
          ← Settings
        </Link>
        <header className="mb-6 mt-3">
          <h1 className="text-[1.75rem] font-bold text-fg">DSCR Pricing</h1>
          <p className="mt-1 text-sm text-muted">
            Upload each investor&rsquo;s refreshed sizer to update the Quote tab. Parse to preview the
            numbers, then publish. The Quote tab prices every scenario through both and flags the best
            execution.
          </p>
        </header>

        {!program?.id ? (
          <p className="text-sm text-muted">No DSCR loan program is configured yet.</p>
        ) : (
          <PricingSizerUpload published={published} />
        )}
      </main>
    </AppShell>
  );
}
