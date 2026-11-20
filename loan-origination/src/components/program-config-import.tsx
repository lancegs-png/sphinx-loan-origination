"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importProgramConfig, type ImportSummary } from "@/app/admin/program-config/actions";

/**
 * Settings → Program configuration import. Upload the exported Program Configuration workbook
 * (.xlsx), preview the diff, then apply. Applying is a deliberate overwrite of the field
 * dictionary + each program's document/task membership from the sheet's toggles.
 */
export function ProgramConfigImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile() {
    const f = fileRef.current?.files?.[0] ?? null;
    setFileName(f?.name ?? null);
    setPreview(null);
    setApplied(false);
    setError(null);
  }

  async function run(dryRun: boolean) {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError("Choose a .xlsx file first.");
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("dryRun", dryRun ? "1" : "0");
    const res = await importProgramConfig(fd);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Import failed.");
      return;
    }
    setPreview(res.summary ?? null);
    if (res.applied) {
      setApplied(true);
      router.refresh();
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="card flex flex-col gap-3 p-5">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={pickFile}
          className="text-sm text-muted"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => run(true)} disabled={busy || !fileName} className="btn">
            {busy ? "Reading…" : "Preview"}
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy || !preview || applied}
            className="btn btn-primary"
            title={!preview ? "Preview first" : undefined}
          >
            {busy ? "Importing…" : "Import"}
          </button>
          {applied && <span className="text-sm text-green-700 dark:text-green-400">Imported.</span>}
          {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </div>

      {preview && (
        <div className="card flex flex-col gap-4 p-5 text-sm">
          <h3 className="font-semibold text-fg">{applied ? "Imported" : "Preview"}</h3>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
            <Stat label="Fields" value={`${preview.fields.total}`} sub={`${preview.fields.new} new`} />
            <Stat
              label="Document types"
              value={`${preview.documents.total}`}
              sub={`${preview.documents.new} new · ${preview.documents.memberships} program links`}
            />
            <Stat label="Tasks" value={`${preview.tasks.total}`} sub={`${preview.tasks.memberships} program links`} />
          </dl>
          <p className="text-muted">
            Programs matched: <span className="text-fg">{preview.programs.matched.length}</span>
            {preview.programs.unknown.length > 0 && (
              <> · ignored: <span className="text-fg">{preview.programs.unknown.join(", ")}</span></>
            )}
          </p>
          {preview.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-400">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {!applied && (
            <p className="text-muted">
              Review the counts above, then click <span className="font-medium text-fg">Import</span> to apply. This
              overwrites each program&apos;s field / document / task set from the sheet; per-loan values and check-offs are
              preserved.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{value}</dd>
      <dd className="text-xs text-muted">{sub}</dd>
    </div>
  );
}
