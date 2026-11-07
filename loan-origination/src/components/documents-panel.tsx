"use client";

import { useState } from "react";
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
const STATUS_COLOR: Record<string, string> = {
  outstanding: "var(--status-outstanding)",
  ordered: "var(--muted)",
  update_needed: "var(--status-outstanding)",
  approved: "var(--status-approved)",
  not_applicable: "var(--muted)",
};

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
  const total = rows.length;
  const approved = rows.filter((r) => r.status === "approved").length;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted">
        {approved} of {total} cleared
      </p>
      {categories.map((cat) => (
        <section key={cat}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{cat}</h3>
          <ul className="flex flex-col gap-3">
            {rows
              .filter((r) => (r.category ?? "Other") === cat)
              .map((r) => (
                <li key={r.id} className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    {canEdit ? (
                      <select
                        value={r.status}
                        onChange={(e) => setStatus(r.id, e.target.value)}
                        className="field select shrink-0 py-1.5 text-xs font-medium"
                        style={{ color: STATUS_COLOR[r.status] }}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s} style={{ color: "var(--fg)" }}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs" style={{ color: STATUS_COLOR[r.status] }}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    )}
                  </div>
                  {r.guidance && <p className="text-xs text-muted">{r.guidance}</p>}
                </li>
              ))}
          </ul>
        </section>
      ))}
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
