import { addLoan } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PipelineTable } from "@/components/pipeline-table";
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
  return (
    <AppShell email={profile.email} nav={navFor(profile)}>
      <main className="mx-auto max-w-6xl px-6 py-9 lg:px-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-fg">Pipeline</h1>
          </div>
          <form action={addLoan}>
            <button className="btn btn-primary">
              <span aria-hidden className="-ml-0.5 text-base leading-none">+</span>
              New loan
            </button>
          </form>
        </div>

        {loans.length === 0 ? (
          <div className="card grid place-items-center px-6 py-20 text-center">
            <p className="text-base font-medium text-fg">No loans yet</p>
            <p className="mt-1 text-sm text-muted">Start a new loan to begin intake.</p>
            <form action={addLoan} className="mt-5">
              <button className="btn btn-primary">
                <span aria-hidden className="-ml-0.5 text-base leading-none">+</span>
                New loan
              </button>
            </form>
          </div>
        ) : (
          <>
            <PipelineSummary loans={loans} />
            <PipelineTable loans={loans} guarantors={guarantors} />
          </>
        )}
      </main>
    </AppShell>
  );
}
