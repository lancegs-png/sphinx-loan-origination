"use client";

import { useState } from "react";
import Link from "next/link";
import { saveProgramChecklist, type ChecklistItemInput } from "@/app/actions";

type RowState = {
  included: boolean;
  required: boolean;
  assignee: "borrower" | "lending_team"; // preserved for AI context; edited via Access below
  visibility: "all" | "lender_only";
  category: string;
  naming: string;
  rules: string;
};

export function ProgramChecklistEditor({
  programId,
  programName,
  docTypes,
  items,
}: {
  programId: string;
  programName: string;
  docTypes: { id: string; name: string }[];
  items: {
    document_type_id: string;
    required: boolean;
    assignee: string;
    visibility: string;
    category: string | null;
    naming_override: string | null;
    review_rules_override: string | null;
  }[];
}) {
  const byId = new Map(items.map((it) => [it.document_type_id, it]));
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const d of docTypes) {
      const it = byId.get(d.id);
      init[d.id] = {
        included: !!it,
        required: it?.required ?? true,
        assignee: (it?.assignee as RowState["assignee"]) ?? "borrower",
        visibility: (it?.visibility as RowState["visibility"]) ?? "all",
        category: it?.category ?? "",
        naming: it?.naming_override ?? "",
        rules: it?.review_rules_override ?? "",
      };
    }
    return init;
  });
  // Types already used across this program, offered as autocomplete suggestions.
  const knownTypes = Array.from(
    new Set(items.map((it) => (it.category ?? "").trim()).filter(Boolean)),
  ).sort();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function update(id: string, patch: Partial<RowState>) {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const payload: ChecklistItemInput[] = docTypes
      .filter((d) => rows[d.id].included)
      .map((d) => ({
        documentTypeId: d.id,
        required: rows[d.id].required,
        assignee: rows[d.id].assignee,
        visibility: rows[d.id].visibility,
        category: rows[d.id].category,
        namingOverride: rows[d.id].naming,
        reviewRulesOverride: rows[d.id].rules,
      }));
    const res = await saveProgramChecklist(programId, payload);
    setBusy(false);
    setMsg(res.ok ? "Saved." : res.error ?? "Save failed.");
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
      <Link
        href={`/admin/programs/${programId}`}
        className="text-sm text-muted transition-colors hover:text-fg"
      >
        ← {programName}
      </Link>
      <header className="mb-8 mt-3">
        <h1 className="text-[1.75rem] font-bold text-fg">{programName}</h1>
        <p className="mt-1 text-sm text-muted">Required documents &amp; tasks</p>
      </header>

      <datalist id="checklist-types">
        {knownTypes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {docTypes.length === 0 ? (
        <p className="text-sm text-muted">
          No document types yet. Add some in{" "}
          <Link href="/admin/document-types" className="text-navy underline decoration-gold/50 underline-offset-2">
            Document Types
          </Link>{" "}
          first.
        </p>
      ) : (
        <ul className="mb-8 flex flex-col gap-3">
          {docTypes.map((d) => {
            const r = rows[d.id];
            return (
              <li key={d.id} className="card p-4">
                <label className="flex items-center gap-2 font-medium text-fg">
                  <input
                    type="checkbox"
                    checked={r.included}
                    onChange={(e) => update(d.id, { included: e.target.checked })}
                    className="accent-navy"
                  />
                  {d.name}
                </label>
                {r.included && (
                  <div className="mt-3 flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={r.required}
                          onChange={(e) => update(d.id, { required: e.target.checked })}
                          className="accent-navy"
                        />
                        required
                      </label>
                      <label className="flex items-center gap-1.5">
                        Access
                        <select
                          value={r.visibility}
                          onChange={(e) =>
                            update(d.id, { visibility: e.target.value as RowState["visibility"] })
                          }
                          className="field select w-auto"
                        >
                          <option value="all">All</option>
                          <option value="lender_only">Lender Only</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5">
                        Type
                        <input
                          value={r.category}
                          onChange={(e) => update(d.id, { category: e.target.value })}
                          list="checklist-types"
                          placeholder="e.g. Borrower Documents"
                          className="field w-56"
                        />
                      </label>
                    </div>
                    <input
                      value={r.naming}
                      onChange={(e) => update(d.id, { naming: e.target.value })}
                      placeholder="Naming override (optional)"
                      className="field w-full"
                    />
                    <textarea
                      value={r.rules}
                      onChange={(e) => update(d.id, { rules: e.target.value })}
                      rows={2}
                      placeholder="AI review rules override (optional)"
                      className="field w-full resize-y"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-4">
        <button onClick={save} disabled={busy} className="btn btn-primary">
          {busy ? "Saving…" : "Save checklist"}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </main>
  );
}
