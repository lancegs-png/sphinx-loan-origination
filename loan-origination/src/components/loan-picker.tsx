import Link from "next/link";
import { stageLabel } from "@/lib/stages";
import { SphinxLogo } from "@/components/brand";
import type { Loan } from "@/lib/types";

export function LoanPicker({ loans, email }: { loans: Loan[]; email: string }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
          <SphinxLogo height={30} />
          <form action="/auth/signout" method="post">
            <button className="btn btn-ghost text-sm">Sign out</button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-[1.75rem] font-bold text-fg">Your loans</h1>
          <p className="mt-1 text-sm text-muted">{email}</p>
        </div>

        {loans.length === 0 ? (
          <div className="card grid place-items-center px-6 py-16 text-center">
            <p className="text-base font-medium text-fg">No loans yet</p>
            <p className="mt-1 text-sm text-muted">
              Your loans will appear here once your lender adds you to a deal.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {loans.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/loans/${l.id}`}
                  className="card group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-2/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-fg">
                      {l.property_address ?? l.loan_number ?? l.opportunity_number}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {l.loan_number ?? l.opportunity_number}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="inline-flex items-center gap-2 text-sm text-muted">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
                      {stageLabel(l.stage)}
                    </span>
                    <svg
                      width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                      className="text-faint transition-colors group-hover:text-muted" aria-hidden
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
