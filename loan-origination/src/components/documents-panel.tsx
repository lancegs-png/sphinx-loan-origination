"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createLoanChecklist, setChecklistItemStatus } from "@/app/actions";
import { createClient } from "@/lib/supabase/client";
import type { ChecklistItem, LoanDocument } from "@/lib/types";

const DOC_BUCKET = "loan-documents";

const STATUSES = ["outstanding", "ordered", "update_needed", "approved", "not_applicable"] as const;
const STATUS_LABEL: Record<string, string> = {
  outstanding: "Outstanding",
  ordered: "Ordered",
  update_needed: "Update needed",
  approved: "Approved",
  not_applicable: "N/A",
};
// Solid dot color per status.
const STATUS_COLOR: Record<string, string> = {
  outstanding: "#ef4444", // red
  ordered: "#06b6d4", // cyan
  update_needed: "#eab308", // yellow
  approved: "#22c55e", // green
  not_applicable: "#ffffff", // white
};
// Rank for a group's roll-up dot: the most-blocking status present wins.
const STATUS_RANK: Record<string, number> = {
  outstanding: 4,
  update_needed: 3,
  ordered: 2,
  approved: 1,
  not_applicable: 0,
};

const VISIBILITY_LABEL: Record<string, string> = {
  all: "All",
  lender_only: "Lender Only",
};

// Item (status dot + name) | Access | Last Note — shared by the header and every row.
const GRID = "grid grid-cols-[minmax(15rem,2.4fr)_7rem_minmax(8rem,1.4fr)] items-stretch";

function Dot({ status, size = 11 }: { status: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: STATUS_COLOR[status] ?? "#ffffff",
        // A thin inset ring gives every dot a crisp edge and keeps the white "N/A" dot visible.
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.22)",
      }}
    />
  );
}

/** Clickable status: a colored dot + label that opens a dropdown of the five statuses. */
function StatusControl({
  status,
  canEdit,
  onChange,
}: {
  status: string;
  canEdit: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!canEdit) {
    return (
      <span className="inline-flex shrink-0" title={STATUS_LABEL[status] ?? status}>
        <Dot status={status} size={12} />
      </span>
    );
  }

  return (
    <div ref={ref} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${STATUS_LABEL[status] ?? status}. Change status`}
        title={`${STATUS_LABEL[status] ?? status} — click to change`}
        className="flex items-center rounded-full p-0.5 transition-transform hover:scale-110"
      >
        <Dot status={status} size={12} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-md border border-line bg-surface shadow-lg"
        >
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={s === status}
              onClick={() => {
                setOpen(false);
                if (s !== status) onChange(s);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${
                s === status ? "font-semibold text-fg" : "text-muted"
              }`}
            >
              <Dot status={s} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // documents whose files are shown
  const [editingFile, setEditingFile] = useState<string | null>(null);
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

  // Group by document Type (the program checklist's `category`), preserving the configured
  // order: rows arrive sorted by `sort`, so a group takes the position of its first item.
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: ChecklistItem[] }[] = [];
    const idx = new Map<string, number>();
    for (const r of rows) {
      const label = (r.category && r.category.trim()) || "Other Documents";
      let gi = idx.get(label);
      if (gi === undefined) {
        gi = out.length;
        idx.set(label, gi);
        out.push({ key: label, label, rows: [] });
      }
      out[gi].rows.push(r);
    }
    return out;
  }, [rows]);

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
    try {
      const supabase = createClient();
      // Upload each file's bytes straight to Storage via a signed URL (no request-size cap),
      // then hand the server just the storage paths to record + mirror to Drive.
      const uploads: { storagePath: string; fileName: string; size: number; contentType: string }[] = [];
      for (const f of files) {
        const signRes = await fetch(`/api/loans/${loanId}/documents/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: f.name }),
        });
        if (!signRes.ok) {
          setMsg("Upload failed — could not start the upload.");
          return;
        }
        const { path, token } = (await signRes.json()) as { path: string; token: string };
        const { error: upErr } = await supabase.storage
          .from(DOC_BUCKET)
          .uploadToSignedUrl(path, token, f, { contentType: f.type || undefined });
        if (upErr) {
          setMsg(`Upload failed: ${upErr.message}`);
          return;
        }
        uploads.push({ storagePath: path, fileName: f.name, size: f.size, contentType: f.type });
      }
      const res = await fetch(`/api/loans/${loanId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklistItemId: itemId, uploads }),
      });
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

  async function renameDoc(docId: string, name: string) {
    const next = name.trim();
    const current = docs.find((d) => d.id === docId)?.file_name;
    setEditingFile(null);
    if (!next || next === current) return;
    setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, file_name: next } : d)));
    const res = await fetch(`/api/loans/${loanId}/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: next }),
    });
    if (!res.ok) {
      setMsg("Could not rename file.");
      if (current) setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, file_name: current } : d)));
    }
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleDoc(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted">
          No document checklist yet — this loan doesn&apos;t have a loan program assigned. The
          checklist is built from the program&apos;s required documents.
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

  const total = rows.length;
  const approved = rows.filter((r) => r.status === "approved").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {approved} of {total} cleared
      </p>

      <div className="overflow-x-auto">
        <div className="card min-w-[680px] overflow-hidden text-sm">
          {/* Column headers */}
          <div className={`${GRID} border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wide text-muted`}>
            <div className="px-3 py-2">Item</div>
            <div className="border-l border-line px-3 py-2">Access</div>
            <div className="border-l border-line px-3 py-2">Last Note</div>
          </div>

          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            const gTotal = g.rows.length;
            const gApproved = g.rows.filter((r) => r.status === "approved").length;
            const rollup = g.rows.reduce(
              (worst, r) => ((STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[worst] ?? 0) ? r.status : worst),
              "not_applicable",
            );
            return (
              <div key={g.key}>
                {/* Group header — click to collapse/expand */}
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 border-b border-line bg-surface-2/70 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                    className={`shrink-0 text-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                  <Dot status={rollup} />
                  <span className="text-[13px] font-semibold text-fg">{g.label}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted">
                    {gApproved}/{gTotal} cleared
                  </span>
                </button>

                {!isCollapsed &&
                  g.rows.map((r) => {
                    const files = docsByItem.get(r.id) ?? [];
                    const isDocExpanded = expanded.has(r.id);
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
                        onDragLeave={canEdit ? () => setDragItem((d) => (d === r.id ? null : d)) : undefined}
                        onDrop={
                          canEdit
                            ? (e) => {
                                e.preventDefault();
                                setDragItem(null);
                                if (e.dataTransfer.files?.length) upload(r.id, e.dataTransfer.files);
                              }
                            : undefined
                        }
                        className={`border-b border-line last:border-0 ${
                          dragItem === r.id ? "bg-gold/5 ring-2 ring-inset ring-gold/60" : ""
                        }`}
                      >
                        <div className={`${GRID} min-h-[2.5rem]`}>
                          {/* Item: chevron (if files) + status dot (click to change) + name + count + upload */}
                          <div className="flex items-center gap-1.5 pl-3 pr-3 py-1.5 font-medium text-fg">
                            {files.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => toggleDoc(r.id)}
                                aria-expanded={isDocExpanded}
                                aria-label={isDocExpanded ? "Hide files" : "Show files"}
                                className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                              >
                                <svg
                                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                                  className={`transition-transform ${isDocExpanded ? "" : "-rotate-90"}`}
                                >
                                  <path d="M6 9l6 6 6-6" />
                                </svg>
                              </button>
                            ) : (
                              <span className="w-[22px] shrink-0" aria-hidden />
                            )}
                            <StatusControl status={r.status} canEdit={canEdit} onChange={(s) => setStatus(r.id, s)} />
                            <span className="min-w-0 break-words" title={r.name}>
                              {r.name}
                            </span>
                            {files.length > 0 && (
                              <span className="shrink-0 rounded-full border border-line px-1.5 text-[11px] tabular-nums text-muted">
                                {files.length}
                              </span>
                            )}
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

                          {/* Access — visibility (who sees it on the deal); set in Settings / the sheet */}
                          <div className="flex items-center border-l border-line px-3 py-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                r.visibility === "lender_only"
                                  ? "bg-navy/10 text-navy"
                                  : "bg-surface-2 text-muted"
                              }`}
                              title={r.visibility === "lender_only" ? "Visible to the lending team only" : "Visible to all (lender, borrower, broker)"}
                            >
                              {VISIBILITY_LABEL[r.visibility] ?? "All"}
                            </span>
                          </div>

                          {/* Last Note — inline editable */}
                          <div className="flex items-stretch border-l border-line">
                            {canEdit ? (
                              <input
                                defaultValue={r.notes ?? ""}
                                onBlur={(e) => setNotes(r.id, e.target.value.trim())}
                                placeholder="Click to add note"
                                className="w-full bg-transparent px-3 py-1.5 text-xs text-fg outline-none placeholder:text-faint focus:bg-gold/5"
                              />
                            ) : (
                              <span className="px-3 py-1.5 text-xs text-muted">{r.notes ?? "—"}</span>
                            )}
                          </div>
                        </div>

                        {/* Nested uploaded files — collapsed by default; stacked when expanded */}
                        {isDocExpanded &&
                          files.map((d) => (
                            <div key={d.id} className="flex items-center gap-2 border-t border-dashed border-line/70 bg-surface-2/20 pl-12 pr-3 py-1.5">
                              <svg
                                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                                className="shrink-0 text-faint"
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <path d="M14 2v6h6" />
                              </svg>
                              {editingFile === d.id ? (
                                <input
                                  autoFocus
                                  defaultValue={d.file_name}
                                  onBlur={(e) => renameDoc(d.id, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    else if (e.key === "Escape") setEditingFile(null);
                                  }}
                                  className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-fg outline-none focus:border-gold"
                                />
                              ) : (
                                <a
                                  href={`/api/loans/${loanId}/documents/${d.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-w-0 truncate text-xs text-navy hover:underline"
                                  title={d.file_name}
                                >
                                  {d.file_name}
                                </a>
                              )}
                              {canEdit && editingFile !== d.id && (
                                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => setEditingFile(d.id)}
                                    aria-label={`Rename ${d.file_name}`}
                                    title="Rename"
                                    className="rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                      <path d="M12 20h9" />
                                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeDoc(d.id)}
                                    aria-label={`Delete ${d.file_name}`}
                                    title="Delete"
                                    className="rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-[color:var(--status-outstanding)]"
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
