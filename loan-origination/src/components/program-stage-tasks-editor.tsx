"use client";

import { useState } from "react";
import Link from "next/link";
import { STAGE_BUCKETS } from "@/lib/stages";
import { saveProgramStageTasks, type StageTaskInput } from "@/app/actions";

type Row = {
  uid: string;
  id?: string;
  bucket: string;
  label: string;
  visibility: "all" | "lender_only";
  assignedTo: "" | "lender" | "borrower" | "broker";
};

let COUNTER = 0;
const nextUid = () => `r${++COUNTER}`;

/**
 * Admin editor for a program's stage-task checklist. Tasks are grouped by the pipeline
 * buckets the team sees on the board; admins add / rename / reorder / remove tasks per
 * stage. Existing tasks keep their id so per-loan completion survives an edit.
 */
export function ProgramStageTasksEditor({
  programId,
  programName,
  tasks,
}: {
  programId: string;
  programName: string;
  tasks: {
    id: string;
    stage_bucket: string;
    label: string;
    sort: number;
    visibility: string;
    assigned_to: string | null;
  }[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    tasks.map((t) => ({
      uid: nextUid(),
      id: t.id,
      bucket: t.stage_bucket,
      label: t.label,
      visibility: (t.visibility as Row["visibility"]) ?? "lender_only",
      assignedTo: (t.assigned_to as Row["assignedTo"]) ?? "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function addTask(bucket: string) {
    setRows((r) => [...r, { uid: nextUid(), bucket, label: "", visibility: "lender_only", assignedTo: "" }]);
  }
  function updateRow(uid: string, patch: Partial<Row>) {
    setRows((r) => r.map((x) => (x.uid === uid ? { ...x, ...patch } : x)));
  }
  function remove(uid: string) {
    setRows((r) => r.filter((x) => x.uid !== uid));
  }
  function move(uid: string, dir: -1 | 1) {
    setRows((r) => {
      const row = r.find((x) => x.uid === uid);
      if (!row) return r;
      const group = r.filter((x) => x.bucket === row.bucket);
      const gIdx = group.findIndex((x) => x.uid === uid);
      const swap = group[gIdx + dir];
      if (!swap) return r;
      const next = [...r];
      const i1 = next.findIndex((x) => x.uid === row.uid);
      const i2 = next.findIndex((x) => x.uid === swap.uid);
      [next[i1], next[i2]] = [next[i2], next[i1]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const payload: StageTaskInput[] = [];
    for (const b of STAGE_BUCKETS) {
      for (const row of rows.filter((x) => x.bucket === b.key)) {
        if (!row.label.trim()) continue;
        payload.push({
          id: row.id,
          stageBucket: b.key,
          label: row.label,
          visibility: row.visibility,
          assignedTo: row.assignedTo || null,
        });
      }
    }
    const res = await saveProgramStageTasks(programId, payload);
    setBusy(false);
    setMsg(res.ok ? "Saved." : res.error ?? "Save failed.");
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-9 lg:px-10">
      <Link
        href={`/admin/programs/${programId}`}
        className="text-sm text-muted transition-colors hover:text-fg"
      >
        ← {programName}
      </Link>
      <header className="mb-8 mt-3">
        <h1 className="text-[1.75rem] font-bold text-fg">{programName}</h1>
        <p className="mt-1 text-sm text-muted">
          Stage task checklist — shown on each deal&apos;s Checklist tab
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {STAGE_BUCKETS.map((b) => {
          const group = rows.filter((x) => x.bucket === b.key);
          return (
            <section key={b.key} className="card p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {b.label}
              </h2>
              {group.length === 0 && <p className="mb-3 text-sm text-faint">No tasks yet.</p>}
              <ul className="flex flex-col gap-2">
                {group.map((row, i) => (
                  <li key={row.uid} className="flex flex-wrap items-center gap-1.5">
                    <input
                      value={row.label}
                      onChange={(e) => updateRow(row.uid, { label: e.target.value })}
                      placeholder="Task description"
                      className="field min-w-[12rem] flex-1"
                    />
                    <select
                      value={row.visibility}
                      onChange={(e) => updateRow(row.uid, { visibility: e.target.value as Row["visibility"] })}
                      aria-label="Visibility"
                      title="Who can see this task"
                      className="field select w-auto text-sm"
                    >
                      <option value="lender_only">Lender Only</option>
                      <option value="all">All</option>
                    </select>
                    <select
                      value={row.assignedTo}
                      onChange={(e) => updateRow(row.uid, { assignedTo: e.target.value as Row["assignedTo"] })}
                      aria-label="Assigned to"
                      title="Assigned to"
                      className="field select w-auto text-sm"
                    >
                      <option value="">Assign…</option>
                      <option value="lender">Lender</option>
                      <option value="borrower">Borrower</option>
                      <option value="broker">Broker</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => move(row.uid, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="btn btn-ghost px-2 text-muted disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(row.uid, 1)}
                      disabled={i === group.length - 1}
                      aria-label="Move down"
                      className="btn btn-ghost px-2 text-muted disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(row.uid)}
                      aria-label="Remove task"
                      className="btn btn-ghost px-2 text-[var(--status-outstanding)]"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => addTask(b.key)}
                className="btn btn-secondary mt-3 text-sm"
              >
                + Add task
              </button>
            </section>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button onClick={save} disabled={busy} className="btn btn-primary">
          {busy ? "Saving…" : "Save checklist"}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </main>
  );
}
