"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveProgramPricing, uploadPricingDocument } from "@/app/actions";

type Mode = "model" | "guidelines" | "document";

const MODEL_FIELDS: { key: string; label: string }[] = [
  { key: "base_rate", label: "Base rate (%)" },
  { key: "points", label: "Points" },
  { key: "term_months", label: "Term (months)" },
  { key: "max_ltv", label: "Max LTV (%)" },
];

export function ProgramPricingEditor({
  programId,
  programName,
  initialMode,
  initialGuidelines,
  initialModel,
}: {
  programId: string;
  programName: string;
  initialMode: Mode;
  initialGuidelines: string;
  initialModel: Record<string, string | number>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [guidelines, setGuidelines] = useState(initialGuidelines);
  const [model, setModel] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const f of MODEL_FIELDS) m[f.key] = initialModel[f.key] != null ? String(initialModel[f.key]) : "";
    return m;
  });
  const [currentFile, setCurrentFile] = useState<string | null>(
    typeof initialModel.file_name === "string" ? initialModel.file_name : null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const numericModel: Record<string, number> = {};
    for (const f of MODEL_FIELDS) {
      const v = parseFloat(model[f.key]);
      if (!Number.isNaN(v)) numericModel[f.key] = v;
    }
    const res = await saveProgramPricing({
      programId,
      mode,
      guidelines,
      model: mode === "model" ? numericModel : {},
    });
    setBusy(false);
    setMsg(res.ok ? "Saved." : res.error ?? "Save failed.");
  }

  async function uploadDoc() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setMsg("Choose a file first.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("programId", programId);
    fd.append("file", f);
    const res = await uploadPricingDocument(fd);
    setBusy(false);
    if (res.ok) {
      setCurrentFile(res.fileName ?? f.name);
      setMsg(`Uploaded ${res.fileName ?? f.name}.`);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } else {
      setMsg(res.error ?? "Upload failed.");
    }
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
        <p className="mt-1 text-sm text-muted">Pricing</p>
      </header>

      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "model"} onChange={() => setMode("model")} className="accent-navy" />
          Pricing model
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "guidelines"} onChange={() => setMode("guidelines")} className="accent-navy" />
          Pasted guidelines
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "document"} onChange={() => setMode("document")} className="accent-navy" />
          Upload document
        </label>
      </div>

      {mode === "model" && (
        <section className="card mb-8 flex flex-col gap-3 p-5">
          {MODEL_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-fg">{f.label}</span>
              <input
                type="number"
                value={model[f.key]}
                onChange={(e) => setModel((m) => ({ ...m, [f.key]: e.target.value }))}
                className="field w-48 text-right tabular-nums"
              />
            </label>
          ))}
        </section>
      )}

      {mode === "guidelines" && (
        <section className="mb-8">
          <textarea
            value={guidelines}
            onChange={(e) => setGuidelines(e.target.value)}
            rows={10}
            placeholder="Paste the program's pricing guidelines here — the lending team (and later the AI) use these to produce a quote."
            className="field w-full resize-y"
          />
        </section>
      )}

      {mode === "document" && (
        <section className="card mb-8 flex flex-col gap-3 p-5">
          <p className="text-sm text-muted">
            Upload a rate sheet or pricing document (PDF, spreadsheet, etc.).
          </p>
          {currentFile && (
            <p className="text-sm text-fg">
              Current file: <span className="font-medium">{currentFile}</span>
            </p>
          )}
          <input ref={fileRef} type="file" className="text-sm text-muted" />
          <button onClick={uploadDoc} disabled={busy} className="btn btn-primary self-start">
            {busy ? "Uploading…" : "Upload"}
          </button>
        </section>
      )}

      {mode !== "document" && (
        <div className="flex items-center gap-4">
          <button onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? "Saving…" : "Save pricing"}
          </button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
      )}

      {mode === "document" && msg && <p className="text-sm text-muted">{msg}</p>}
    </main>
  );
}
