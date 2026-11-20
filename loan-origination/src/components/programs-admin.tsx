"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveProgram } from "@/app/actions";

export type ProgramRow = {
  id: string;
  name: string;
  loan_type_key: string | null;
  asset_class: string | null;
  sort: number;
};

type AssetClass = "residential" | "commercial";
const CLASSES: { key: AssetClass; label: string }[] = [
  { key: "residential", label: "Residential" },
  { key: "commercial", label: "Commercial" },
];

/**
 * Settings → Loan programs. Lists the program catalog grouped by asset class, lets an admin
 * reclassify a program (moving it between groups) and add a new one. Configuration of each
 * program's intake / checklist / tasks / pricing stays on its own page.
 */
export function ProgramsAdmin({ programs }: { programs: ProgramRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; key: string; assetClass: AssetClass }>({
    name: "",
    key: "",
    assetClass: "residential",
  });

  async function reclassify(p: ProgramRow, assetClass: AssetClass) {
    if (assetClass === p.asset_class) return;
    setBusy(true);
    setMsg(null);
    const res = await saveProgram({ id: p.id, name: p.name, assetClass });
    setBusy(false);
    if (res.ok) router.refresh();
    else setMsg(res.error ?? "Could not move the program.");
  }

  async function add() {
    if (!draft.name.trim()) {
      setMsg("Name is required.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await saveProgram({
      name: draft.name,
      loanTypeKey: draft.key || draft.name,
      assetClass: draft.assetClass,
    });
    setBusy(false);
    if (res.ok) {
      setDraft({ name: "", key: "", assetClass: "residential" });
      setAdding(false);
      router.refresh();
    } else {
      setMsg(res.error ?? "Could not add the program.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {CLASSES.map((c) => {
        const rows = programs
          .filter((p) => (p.asset_class ?? "residential") === c.key)
          .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
        return (
          <div key={c.key}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{c.label}</h3>
            {rows.length === 0 ? (
              <div className="card px-5 py-6 text-center text-sm text-muted">No programs in this class.</div>
            ) : (
              <div className="card overflow-hidden">
                {rows.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-0"
                  >
                    <div className="min-w-0">
                      <Link href={`/admin/programs/${p.id}`} className="font-semibold text-fg hover:underline">
                        {p.name}
                      </Link>
                      {p.loan_type_key && (
                        <span className="ml-2 text-xs text-faint tabular-nums">{p.loan_type_key}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={c.key}
                        disabled={busy}
                        onChange={(e) => reclassify(p, e.target.value as AssetClass)}
                        aria-label={`Asset class for ${p.name}`}
                        className="field text-sm"
                      >
                        {CLASSES.map((x) => (
                          <option key={x.key} value={x.key}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                      <Link
                        href={`/admin/programs/${p.id}`}
                        className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-fg"
                      >
                        Configure
                        <span aria-hidden className="text-faint">
                          →
                        </span>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="card flex flex-col gap-3 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Commercial SBA"
                className="field"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Program key (optional)</span>
              <input
                value={draft.key}
                onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                placeholder="commercial_sba"
                className="field"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Asset class</span>
              <select
                value={draft.assetClass}
                onChange={(e) => setDraft((d) => ({ ...d, assetClass: e.target.value as AssetClass }))}
                className="field"
              >
                {CLASSES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={add} disabled={busy} className="btn btn-primary">
              {busy ? "Adding…" : "Add program"}
            </button>
            <button onClick={() => setAdding(false)} disabled={busy} className="btn">
              Cancel
            </button>
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={() => setAdding(true)} className="btn self-start">
            + Add program
          </button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
      )}
    </div>
  );
}
