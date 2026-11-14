"use client";

import { useEffect, useMemo, useState } from "react";
import { PipelineTable } from "./pipeline-table";
import { PipelineKanban } from "./pipeline-kanban";
import { LOAN_STATUSES } from "@/lib/status";
import type { Loan } from "@/lib/types";

const VIEW_KEY = "sphinx.pipeline.view";
const STATUS_KEY = "sphinx.pipeline.status";

// Statuses hidden from the default "Active pipeline" view (on_hold stays — it's paused but live).
const HIDDEN_STATUSES = new Set(["archived", "withdrawn", "declined"]);

// Status filter options: the default active-pipeline view, everything, or one status.
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "pipeline", label: "Active pipeline" },
  { key: "all", label: "All statuses" },
  ...LOAN_STATUSES.map((s) => ({ key: s.key, label: s.label })),
];

/** Pipeline with a Table / Board (Kanban) toggle; the choice is remembered per browser. */
export function PipelineView({
  loans,
  guarantors,
}: {
  loans: Loan[];
  guarantors: Record<string, string>;
}) {
  const [view, setView] = useState<"table" | "board">("table");
  const [statusFilter, setStatusFilter] = useState("pipeline");

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "board" || v === "table") setView(v);
      const s = localStorage.getItem(STATUS_KEY);
      if (s && STATUS_FILTERS.some((f) => f.key === s)) setStatusFilter(s);
    } catch {
      /* ignore */
    }
  }, []);

  function pick(v: "table" | "board") {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }

  function pickStatus(s: string) {
    setStatusFilter(s);
    try {
      localStorage.setItem(STATUS_KEY, s);
    } catch {
      /* ignore */
    }
  }

  // Default ("pipeline") hides loans that aren't moving forward; "all" shows everything;
  // any specific status narrows to just that one.
  const visible = useMemo(() => {
    if (statusFilter === "all") return loans;
    if (statusFilter === "pipeline") return loans.filter((l) => !HIDDEN_STATUSES.has(l.status));
    return loans.filter((l) => l.status === statusFilter);
  }, [loans, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex self-start rounded-md border border-line p-0.5 text-sm">
          {(["table", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => pick(v)}
              className={`rounded px-3 py-1 font-medium capitalize ${
                view === v ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {v === "board" ? "Board" : "Table"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="font-medium">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => pickStatus(e.target.value)}
            aria-label="Filter by loan status"
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm font-medium text-fg outline-none focus:border-gold"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {view === "table" ? (
        <PipelineTable loans={visible} guarantors={guarantors} />
      ) : (
        <PipelineKanban loans={visible} guarantors={guarantors} />
      )}
    </div>
  );
}
