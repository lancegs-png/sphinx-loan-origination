"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { STAGE_BUCKETS, bucketIndex } from "@/lib/stages";
import { setLoanStage } from "@/app/actions";

/**
 * Lender control to manually move a loan through the six funnel buckets. Selecting a
 * bucket writes its primary stage; the stage bar (driven by loans.stage) updates on refresh.
 */
export function StageSelect({ loanId, currentStage }: { loanId: string; currentStage: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = bucketIndex(currentStage);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const i = Number(e.target.value);
    const stage = STAGE_BUCKETS[i]?.stages[0];
    if (!stage) return;
    startTransition(async () => {
      await setLoanStage({ loanId, stage });
      router.refresh();
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="font-medium">Stage</span>
      <select
        value={current < 0 ? "" : current}
        onChange={onChange}
        disabled={pending}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm font-medium text-fg outline-none focus:border-gold disabled:opacity-50"
      >
        {current < 0 && <option value="">—</option>}
        {STAGE_BUCKETS.map((b, i) => (
          <option key={b.label} value={i}>
            {b.label}
          </option>
        ))}
      </select>
    </label>
  );
}
