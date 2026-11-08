"use client";

import { useState } from "react";
import { addInternalNote } from "@/app/actions";
import type { InternalNote } from "@/lib/types";

/** Team-only notes on a loan, with an inline composer to add more. */
export function NotesPanel({
  loanId,
  initialNotes,
}: {
  loanId: string;
  initialNotes: InternalNote[];
}) {
  const [notes, setNotes] = useState<InternalNote[]>(initialNotes);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const res = await addInternalNote({ loanId, body: text });
    setBusy(false);
    if (!res.ok || !res.note) {
      setError(res.error ?? "Couldn’t save the note.");
      return;
    }
    setNotes((prev) => [...prev, res.note!]);
    setBody("");
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="card p-3.5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add(e);
          }}
          rows={3}
          placeholder="Add an internal note (team only)…"
          className="field w-full resize-none text-sm"
        />
        {error && (
          <p className="mt-2 text-xs" style={{ color: "var(--status-outstanding)" }}>
            {error}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-faint">⌘/Ctrl + Enter to save</span>
          <button type="submit" disabled={busy || !body.trim()} className="btn btn-primary btn-sm">
            {busy ? "Saving…" : "Add note"}
          </button>
        </div>
      </form>

      <ul className="space-y-3">
        {notes.length === 0 && <p className="text-muted">No internal notes yet.</p>}
        {notes.map((n) => (
          <li key={n.id} className="card p-3.5">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-fg">
                {n.author?.full_name || n.author?.email || "Unknown"}
              </span>
              <span className="text-faint">{new Date(n.created_at).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap text-fg">{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
