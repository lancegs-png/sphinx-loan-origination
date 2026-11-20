"use client";

import { STAGE_BUCKETS } from "@/lib/stages";
import type { Loan } from "@/lib/types";

/**
 * Pipeline overview strip: one tile per funnel bucket, showing the number of loans and the
 * total loan-amount volume currently in that bucket. The buckets (see `@/lib/stages`) roll up
 * the eight canonical stages into six; every stage lands in exactly one bucket. Each tile is a
 * filter: clicking it narrows the pipeline below to that bucket; clicking the active tile clears.
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

export function PipelineSummary({
  loans,
  activeBuckets,
  onPick,
}: {
  loans: Loan[];
  activeBuckets: Set<string>;
  onPick: (key: string) => void;
}) {
  const stats = STAGE_BUCKETS.map((b) => {
    const inBucket = loans.filter((l) => (b.stages as readonly string[]).includes(l.stage));
    const volume = inBucket.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0);
    return { key: b.key, label: b.label, count: inBucket.length, volume };
  });

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {stats.map((s) => {
        const active = activeBuckets.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick(s.key)}
            aria-pressed={active}
            title={active ? `${s.label} is in the filter — click to remove` : `Add ${s.label} to the filter`}
            className={`card px-4 py-3 text-left transition-colors hover:border-gold/60 ${
              active ? "border-gold/70 ring-2 ring-gold/60" : ""
            }`}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{s.label}</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-fg">{s.count}</p>
            <p className="mt-0.5 text-sm tabular-nums text-muted">{compactUsd(s.volume)}</p>
          </button>
        );
      })}
    </div>
  );
}
