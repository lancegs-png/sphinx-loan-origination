import { STAGE_BUCKETS } from "@/lib/stages";
import type { Loan } from "@/lib/types";

/**
 * Pipeline overview strip: one tile per funnel bucket, showing the number of
 * loans and the total loan-amount volume currently in that bucket. The buckets
 * (see `@/lib/stages`) roll up the eight canonical stages into six; every stage
 * lands in exactly one bucket.
 */
function compactUsd(n: number): string {
  if (n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function PipelineSummary({ loans }: { loans: Loan[] }) {
  const stats = STAGE_BUCKETS.map((b) => {
    const inBucket = loans.filter((l) => (b.stages as readonly string[]).includes(l.stage));
    const volume = inBucket.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0);
    return { label: b.label, count: inBucket.length, volume };
  });

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <div key={s.label} className="card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{s.label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-fg">{s.count}</p>
          <p className="mt-0.5 text-sm tabular-nums text-muted">{compactUsd(s.volume)}</p>
        </div>
      ))}
    </div>
  );
}
