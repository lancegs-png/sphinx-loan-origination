import { AppShell } from "@/components/app-shell";
import { NewDealButton } from "@/components/new-deal-button";
import { PipelineView } from "@/components/pipeline-view";
import { PipelineSummary } from "@/components/pipeline-summary";
import { navFor } from "@/lib/nav";
import type { Loan, Profile } from "@/lib/types";

export function PipelineHome({
  loans,
  profile,
  guarantors,
}: {
  loans: Loan[];
  profile: Profile;
  guarantors: Record<string, string>;
}) {
  // Summary tiles reflect the active pipeline — exclude loans that aren't moving forward
  // (archived / withdrawn / declined). The view below passes all loans so its Status filter
  // can reveal them.
  const hidden = new Set(["archived", "withdrawn", "declined"]);
  const activeLoans = loans.filter((l) => !hidden.has(l.status));
  return (
    <AppShell email={profile.email} nav={navFor(profile)}>
      <main className="mx-auto max-w-[90rem] px-6 py-9 lg:px-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-fg">Pipeline</h1>
          </div>
          <NewDealButton />
        </div>

        {loans.length === 0 ? (
          <div className="card grid place-items-center px-6 py-20 text-center">
            <p className="text-base font-medium text-fg">No loans yet</p>
            <p className="mt-1 text-sm text-muted">Start a new deal to begin intake.</p>
            <div className="mt-5">
              <NewDealButton />
            </div>
          </div>
        ) : (
          <>
            <PipelineSummary loans={activeLoans} />
            <PipelineView loans={loans} guarantors={guarantors} />
          </>
        )}
      </main>
    </AppShell>
  );
}
