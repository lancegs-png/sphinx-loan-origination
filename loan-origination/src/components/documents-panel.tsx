"use client";

import { Fragment, useState } from "react";
import { createLoanChecklist, setChecklistItemStatus } from "@/app/actions";
import type { ChecklistItem } from "@/lib/types";

const STATUSES = ["outstanding", "ordered", "update_needed", "approved", "not_applicable"];
const STATUS_LABEL: Record<string, string> = {
  outstanding: "Outstanding",
  ordered: "Ordered",
  update_needed: "Update needed",
  approved: "Approved",
  not_applicable: "N/A",
};
// Filled status cell (color + tinted background), matching the deal dashboard.
const STATUS_CELL: Record<string, string> = {
  outstanding: "status-outstanding",
  ordered: "",
  update_needed: "status-update",
  approved: "status-approved",
  not_applicable: "",
};

// Four-column spreadsheet grid shared by the header and every row.
const GRID = "grid grid-cols-[minmax(8rem,22%)_8.5rem_minmax(0,1fr)_minmax(6rem,18%)] items-stretch";

export function DocumentsPanel({
  loanId,
  items,
  canEdit,
  canGenerate,
}: {
  loanId: string;
  items: ChecklistItem[];
  canEdit: boolean;
  canGenerate: boolean;
}) {
  const [rows, setRows] = useState<ChecklistItem[]>(items);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    const res = await createLoanChecklist(loanId);
    setBusy(false);
    setMsg(res.ok ? "Checklist created — reload to see it." : res.error ?? "Could not create checklist.");
  }

  async function setStatus(itemId: string, status: string) {
    setRows((prev) => prev.map((r) => (r.id === itemId ? { ...r, status } : r)));
    const res = await setChecklistItemStatus({ loanId, itemId, status });
    if (!res.ok) setMsg(res.error ?? "Could not update.");
  }

  async function setNotes(itemId: string, notes: string) {
    const row = rows.find((r) => r.id === itemId);
    if (!row || (row.notes ?? "") === notes) return;
    setRows((prev) => prev.map((r) => (r.id === itemId ? { ...r, notes } : r)));
    const res = await setChecklistItemStatus({ loanId, itemId, status: row.status, notes });
    if (!res.ok) setMsg(res.error ?? "Could not save note.");
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted">
          No checklist yet. It&apos;s created from the program checklist when the loan reaches Processing.
        </p>
        {canGenerate && (
          <button onClick={generate} disabled={busy} className="btn btn-primary self-start">
            {busy ? "Creating…" : "Generate checklist"}
          </button>
        )}
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </div>
    );
  }

  const categories = [...new Set(rows.map((r) => r.category ?? "Other"))];
  const showCategory = categories.length > 1;
  const total = rows.length;
  const approved = rows.filter((r) => r.status === "approved").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {approved} of {total} cleared
      </p>

      <div className="overflow-x-auto">
        <div className="card min-w-[640px] overflow-hidden text-sm">
          {/* Column headers */}
          <div
            className={`${GRID} border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wide text-muted`}
          >
            <div className="px-3 py-1.5">Document</div>
            <div className="border-l border-line px-3 py-1.5">Status</div>
            <div className="border-l border-line px-3 py-1.5">Guidelines</div>
            <div className="border-l border-line px-3 py-1.5">Notes</div>
          </div>

          <div className="divide-y divide-line">
            {categories.map((cat) => (
              <Fragment key={cat}>
                {showCategory && (
                  <div className="bg-surface-2/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {cat}
                  </div>
                )}
                {rows
                  .filter((r) => (r.category ?? "Other") === cat)
                  .map((r) => (
                    <div key={r.id} className={`${GRID} min-h-[2.25rem]`}>
                      {/* Document */}
                      <div className="flex items-center px-3 py-1.5 font-medium text-fg">
                        <span className="truncate" title={r.name}>
                          {r.name}
                        </span>
                      </div>

                      {/* Status (colored cell) */}
                      <div
                        className={`flex items-stretch border-l border-line ${STATUS_CELL[r.status] ?? ""}`}
                      >
                        {canEdit ? (
                          <select
                            value={r.status}
                            onChange={(e) => setStatus(r.id, e.target.value)}
                            className="w-full cursor-pointer appearance-none bg-transparent px-3 py-1.5 text-xs font-medium text-inherit outline-none"
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s} style={{ color: "var(--fg)" }}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="px-3 py-1.5 text-xs font-medium">{STATUS_LABEL[r.status]}</span>
                        )}
                      </div>

                      {/* Guidelines */}
                      <div className="flex items-center border-l border-line px-3 py-1.5 text-xs text-muted">
                        <span>{r.guidance ?? ""}</span>
                      </div>

                      {/* Notes */}
                      <div className="flex items-stretch border-l border-line">
                        {canEdit ? (
                          <input
                            defaultValue={r.notes ?? ""}
                            onBlur={(e) => setNotes(r.id, e.target.value.trim())}
                            placeholder="—"
                            className="w-full bg-transparent px-3 py-1.5 text-xs text-fg outline-none placeholder:text-faint focus:bg-gold/5"
                          />
                        ) : (
                          <span className="px-3 py-1.5 text-xs text-muted">{r.notes ?? ""}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
