import Link from "next/link";
import { addLoan } from "@/app/actions";
import { stageLabel } from "@/lib/stages";
import type { Loan, Profile } from "@/lib/types";

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function PipelineHome({ loans, profile }: { loans: Loan[]; profile: Profile }) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="text-muted">{profile.email}</p>
        </div>
        <div className="flex items-center gap-3">
          {profile.lender_user_type === "admin" && (
            <Link href="/admin" className="rounded-md border border-line px-4 py-2.5 font-medium">
              Admin
            </Link>
          )}
          <form action={addLoan}>
            <button className="rounded-md bg-fg px-4 py-2.5 font-medium text-white">+ Add Loan</button>
          </form>
          <form action="/auth/signout" method="post">
            <button className="rounded-md border border-line px-4 py-2.5 font-medium">Sign out</button>
          </form>
        </div>
      </header>

      {loans.length === 0 ? (
        <p className="text-muted">No loans yet. Click “Add Loan” to start one.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-sm text-muted">
                <th className="py-3 pr-4 font-medium">Loan / Opp #</th>
                <th className="py-3 pr-4 font-medium">Address</th>
                <th className="py-3 pr-4 font-medium">Borrower</th>
                <th className="py-3 pr-4 font-medium">Amount</th>
                <th className="py-3 pr-4 font-medium">Type</th>
                <th className="py-3 pr-4 font-medium">Stage</th>
                <th className="py-3 pr-4 font-medium">Expected close</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id} className="border-b border-line hover:bg-black/[0.02]">
                  <td className="py-3 pr-4">
                    <Link href={`/loans/${l.id}`} className="font-medium underline">
                      {l.loan_number ?? l.opportunity_number}
                    </Link>
                    {!l.loan_number && (
                      <span className="ml-1.5 rounded bg-black/5 px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                        Opp
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">{l.property_address ?? "—"}</td>
                  <td className="py-3 pr-4">{l.borrower_name ?? "—"}</td>
                  <td className="py-3 pr-4">{money(l.loan_amount)}</td>
                  <td className="py-3 pr-4">{l.loan_type ?? "—"}</td>
                  <td className="py-3 pr-4">{stageLabel(l.stage)}</td>
                  <td className="py-3 pr-4">{l.closing_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
