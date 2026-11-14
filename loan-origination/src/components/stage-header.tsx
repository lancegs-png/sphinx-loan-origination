"use client";

import { useState, useTransition } from "react";
import { StageBar } from "./stage-bar";
import { STAGE_BUCKETS, bucketIndex } from "@/lib/stages";
import { LOAN_STATUSES } from "@/lib/status";
import { setLoanStage, setLoanStatus } from "@/app/actions";

/**
 * The deal header's stage row: the progress bar plus (for lenders) a dropdown to move
 * the loan through the six funnel buckets. The bar and dropdown share one optimistic
 * state, so selecting a stage updates both instantly — the server action persists and
 * logs in the background with no full-page refresh (reverting only if it fails).
 */
export function StageHeader({
  loanId,
  currentStage,
  currentStatus,
  canEdit,
}: {
  loanId: string;
  currentStage: string;
  currentStatus: string;
  canEdit: boolean;
}) {
  const [stage, setStage] = useState(currentStage);
  const [status, setStatus] = useState(currentStatus);
  const [pending, startTransition] = useTransition();
  const [statusPending, startStatusTransition] = useTransition();
  const current = bucketIndex(stage);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = STAGE_BUCKETS[Number(e.target.value)]?.stages[0];
    if (!next || next === stage) return;
    const prev = stage;
    setStage(next); // optimistic — bar + dropdown update immediately
    startTransition(async () => {
      const res = await setLoanStage({ loanId, stage: next });
      if (!res.ok) setStage(prev); // revert if the write was rejected
    });
  }

  function onStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === status) return;
    const prev = status;
    setStatus(next); // optimistic
    startStatusTransition(async () => {
      const res = await setLoanStatus({ loanId, status: next });
      if (!res.ok) setStatus(prev); // revert if rejected
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <StageBar currentStage={stage} />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
          <label className="flex items-center gap-2 text-sm text-muted">
            <span className="font-medium">Status</span>
            <select
              value={status}
              onChange={onStatusChange}
              disabled={statusPending}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm font-medium text-fg outline-none focus:border-gold disabled:opacity-50"
            >
              {!LOAN_STATUSES.some((s) => s.key === status) && <option value={status}>{status}</option>}
              {LOAN_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
