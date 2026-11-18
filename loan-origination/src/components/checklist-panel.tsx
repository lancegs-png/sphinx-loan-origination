"use client";

import { useMemo, useState } from "react";
import { setLoanTaskStatus } from "@/app/actions";
import { bucketKeyForStage } from "@/lib/stages";
import type { StageTask, StageTaskGroup } from "@/lib/types";

/** MM/DD/YY for the completion stamp. */
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * The per-deal Checklist tab: operational tasks grouped by pipeline stage, with the loan's
 * current stage highlighted. Any lending-team member checks tasks off and can add a note;
 * completion is optimistic and persisted via setLoanTaskStatus (who/when is recorded).
 */
export function ChecklistPanel({
  loanId,
  currentStage,
  groups,
  canEdit,
}: {
  loanId: string;
  currentStage: string;
  groups: StageTaskGroup[];
  canEdit: boolean;
}) {
  const [state, setState] = useState<StageTaskGroup[]>(groups);
  const [msg, setMsg] = useState<string | null>(null);
  const currentBucket = bucketKeyForStage(currentStage);

  function patchTask(taskId: string, patch: Partial<StageTask>) {
    setState((groups) =>
      groups.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      })),
    );
  }

  async function toggle(task: StageTask) {
    const done = !task.done;
    patchTask(task.id, {
      done,
      completedAt: done ? new Date().toISOString() : null,
      completedBy: done ? "You" : null,
    });
    const res = await setLoanTaskStatus({ loanId, taskId: task.id, done });
    if (!res.ok) {
      setMsg(res.error ?? "Could not update the task.");
      patchTask(task.id, { done: task.done, completedAt: task.completedAt, completedBy: task.completedBy });
    }
  }

  async function saveNote(task: StageTask, note: string) {
    if ((task.note ?? "") === note) return;
    patchTask(task.id, { note: note || null });
    const res = await setLoanTaskStatus({ loanId, taskId: task.id, note });
    if (!res.ok) setMsg(res.error ?? "Could not save the note.");
  }

  const totals = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const g of state) {
      total += g.tasks.length;
      done += g.tasks.filter((t) => t.done).length;
    }
    return { done, total };
  }, [state]);

  if (state.length === 0) {
    return (
      <p className="text-sm text-muted">
        No checklist is configured for this loan&apos;s program yet. An admin can add tasks under
        Settings → the loan program → <span className="font-medium">Checklist Tasks</span>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted">
        {totals.done} of {totals.total} tasks complete
      </p>

      {state.map((g) => {
        const done = g.tasks.filter((t) => t.done).length;
        const remaining = g.tasks.length - done;
        const isCurrent = g.bucketKey === currentBucket;
        return (
          <section key={g.bucketKey} className={`card p-4 ${isCurrent ? "ring-2 ring-gold/60" : ""}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg">
                {g.bucketLabel}
                {isCurrent && <span className="chip bg-gold/10 text-navy">Current stage</span>}
              </h2>
              <span className="shrink-0 text-xs text-muted">
                {remaining === 0 ? "All done" : `${remaining} remaining`} · {done}/{g.tasks.length}
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {g.tasks.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 py-2">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={t.done}
                      disabled={!canEdit}
                      onChange={() => toggle(t)}
                      className="mt-0.5 accent-navy"
                    />
                    <span className="flex-1">
                      <span className={t.done ? "text-muted line-through" : "text-fg"}>{t.label}</span>
                      {t.done && t.completedBy && (
                        <span className="ml-2 text-xs text-faint">
                          Done by {t.completedBy}
                          {t.completedAt ? ` · ${fmtDate(t.completedAt)}` : ""}
                        </span>
                      )}
                    </span>
                  </label>
                  {canEdit ? (
                    <input
                      defaultValue={t.note ?? ""}
                      onBlur={(e) => saveNote(t, e.target.value.trim())}
                      placeholder="Add a note…"
                      className="ml-7 bg-transparent text-xs text-fg outline-none placeholder:text-faint focus:bg-gold/5"
                    />
                  ) : (
                    t.note && <span className="ml-7 text-xs text-muted">{t.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
