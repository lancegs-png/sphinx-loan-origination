"use client";

import { describeEvent, actorName, type ActivityEvent } from "@/lib/activity";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ActivityPanel({
  loanId,
  events,
  fieldLabels,
}: {
  loanId: string;
  events: ActivityEvent[];
  fieldLabels: Record<string, string>;
}) {
  const labelFor = (k: string) => fieldLabels[k] ?? k;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {events.length} {events.length === 1 ? "event" : "events"}
        </p>
        <a
          href={`/api/loans/${loanId}/activity/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary text-xs"
        >
          Download PDF log
        </a>
      </div>

      {events.length === 0 ? (
        <p className="text-muted">No activity recorded yet.</p>
      ) : (
        <ol className="card divide-y divide-line overflow-hidden text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-3 py-2">
              <span className="w-40 shrink-0 text-xs tabular-nums text-muted">{fmtTime(e.created_at)}</span>
              <span className="min-w-0 flex-1 text-fg">{describeEvent(e, labelFor)}</span>
              <span className="shrink-0 text-xs text-muted">
                {actorName(e)}
                {e.is_internal ? " · internal" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
