import Link from "next/link";
import { stageLabel } from "@/lib/stages";
import type { Loan } from "@/lib/types";

export function LoanPicker({ loans, email }: { loans: Loan[]; email: string }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your loans</h1>
          <p className="text-muted">{email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button className="rounded-md border border-line px-4 py-2.5 font-medium">Sign out</button>
        </form>
      </header>

      {loans.length === 0 ? (
        <p className="text-muted">You don’t have any loans yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((l) => (
            <li key={l.id}>
              <Link
                href={`/loans/${l.id}`}
                className="flex items-center justify-between rounded-md border border-line px-4 py-4 hover:bg-black/[0.02]"
              >
                <span className="font-medium">{l.property_address ?? l.loan_number ?? l.opportunity_number}</span>
                <span className="text-muted">{stageLabel(l.stage)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
