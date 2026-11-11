"use client";

import { useMemo, useState } from "react";
import { createLoanChecklist, setChecklistItemStatus } from "@/app/actions";
import type { ChecklistItem, LoanDocument } from "@/lib/types";

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
  documents,
  canEdit,
  canGenerate,
}: {
  loanId: string;
  items: ChecklistItem[];
  documents: LoanDocument[];
  canEdit: boolean;
  canGenerate: boolean;
}) {
  const [rows, setRows] = useState<ChecklistItem[]>(items);
  const [docs, setDocs] = useState<LoanDocument[]>(documents);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const docsByItem = useMemo(() => {
    const m = new Map<string, LoanDocument[]>();
    for (const d of docs) {
      if (!d.checklist_item_id) continue;
      const arr = m.get(d.checklist_item_id) ?? [];
      arr.push(d);
      m.set(d.checklist_item_id, arr);
    }
    return m;
  }, [docs]);

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

  async function upload(itemId: string, fileList: FileList) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(itemId);
    setMsg(null);
    const fd = new FormData();
    fd.set("checklistItemId", itemId);
    for (const f of files) fd.append("files", f);
    try {
      const res = await fetch(`/api/loans/${loanId}/documents`, { method: "POST", body: fd });
      if (!res.ok) {
        setMsg((await res.text().catch(() => "")) || "Upload failed.");
      } else {
        const json = (await res.json()) as { documents: LoanDocument[] };
        setDocs((prev) => [...prev, ...json.documents]);
      }
    } catch {
      setMsg("Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  async function removeDoc(docId: string) {
    const res = await fetch(`/api/loans/${loanId}/documents/${docId}`, { method: "DELETE" });
    if (!res.ok) {
      setMsg("Could not delete file.");
      return;
    }
    setDocs((prev) => prev.filter((d) => d.id !== docId));
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

  // Group by who provides the doc: borrower-provided vs lender-ordered (the assignee).
  const GROUPS: { key: string; label: string; match: (r: ChecklistItem) => boolean }[] = [
    { key: "borrower", label: "Borrower Provided", match: (r) => r.assignee !== "lending_team" },
    { key: "lender", label: "Lender Ordered", match: (r) => r.assignee === "lending_team" },
  ];
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

          <div className="flex flex-col gap-4">
            {GROUPS.map((g) => {
              const groupRows = rows.filter(g.match);
              if (groupRows.length === 0) return null;
              return (
                <div key={g.key}>
                  <div className="border-y border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg">
                    {g.label}
                  </div>
                  <div className="divide-y divide-line">
                    {groupRows.map((r) => {
                    const files = docsByItem.get(r.id) ?? [];
                    return (
                      <div
                        key={r.id}
                        onDragOver={
                          canEdit
                            ? (e) => {
                                e.preventDefault();
                                setDragItem(r.id);
                              }
                            : undefined
                        }
                        onDragLeave={
                          canEdit ? () => setDragItem((d) => (d === r.id ? null : d)) : undefined
                        }
                        onDrop={
                          canEdit
                            ? (e) => {
                                e.preventDefault();
                                setDragItem(null);
                                if (e.dataTransfer.files?.length) upload(r.id, e.dataTransfer.files);
                              }
                            : undefined
                        }
                        className={dragItem === r.id ? "bg-gold/5 ring-2 ring-inset ring-gold/60" : undefined}
                      >
                        <div className={`${GRID} min-h-[2.25rem]`}>
                          {/* Document + upload */}
                          <div className="flex items-center gap-2 px-3 py-1.5 font-medium text-fg">
                            <span className="truncate" title={r.name}>
                              {r.name}
                            </span>
                            {canEdit && (
                              <label
                                title="Upload files, or drag a file onto this row"
                                className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-fg"
                              >
                                {uploading === r.id ? "Uploading…" : "+ Upload"}
                                <input
                                  type="file"
                                  multiple
                                  className="hidden"
                                  disabled={uploading === r.id}
                                  onChange={(e) => {
                                    if (e.target.files) upload(r.id, e.target.files);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            )}
                          </div>

                          {/* Status (colored cell) */}
                          <div className={`flex items-stretch border-l border-line ${STATUS_CELL[r.status] ?? ""}`}>
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

                        {/* Attachments strip — shows uploaded files; upload entry is the name cell + drag-drop */}
                        {files.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-line/70 bg-surface-2/30 px-3 py-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Files</span>
                            {files.map((d) => (
                              <span
                                key={d.id}
                                className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-xs"
                              >
                                <a
                                  href={`/api/loans/${loanId}/documents/${d.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="max-w-[14rem] truncate text-navy hover:underline"
                                  title={d.file_name}
                                >
                                  {d.file_name}
                                </a>
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => removeDoc(d.id)}
                                    aria-label={`Remove ${d.file_name}`}
                                    className="leading-none text-faint hover:text-[color:var(--status-outstanding)]"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
