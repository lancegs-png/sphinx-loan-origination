import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PipelineView } from "@/components/pipeline-view";
import { navFor } from "@/lib/nav";
import type { Loan, Profile } from "@/lib/types";

/**
 * Broker portal pipeline: the broker's own loans (scoped by RLS to the deals they're a
 * participant on). Read-only table/board like the lending-team view, but new loans come in
 * through the intake form, not the lender new-deal modal.
 */
export function BrokerPipeline({
  loans,
  profile,
  guarantors,
}: {
  loans: Loan[];
  profile: Profile;
  guarantors: Record<string, string>;
}) {
  return (
    <AppShell email={profile.email} nav={navFor(profile)}>
      <main className="mx-auto max-w-[90rem] px-6 py-9 lg:px-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-fg">Pipeline</h1>
            <p className="mt-1 text-sm text-muted">Your submitted loans.</p>
          </div>
          <Link href="/intake" className="btn btn-primary">
            New loan
          </Link>
        </div>

        {loans.length === 0 ? (
          <div className="card grid place-items-center px-6 py-20 text-center">
            <p className="text-base font-medium text-fg">No loans yet</p>
            <p className="mt-1 text-sm text-muted">Submit a new loan to get started.</p>
            <div className="mt-5">
              <Link href="/intake" className="btn btn-primary">
                New loan
              </Link>
            </div>
          </div>
        ) : (
          <PipelineView loans={loans} guarantors={guarantors} />
        )}
      </main>
    </AppShell>
  );
}
