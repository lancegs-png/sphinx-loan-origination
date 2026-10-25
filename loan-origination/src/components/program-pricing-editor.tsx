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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{programName}</h1>
          <p className="text-muted">Pricing</p>
        </div>
        <Link
          href={`/admin/programs/${programId}`}
          className="rounded-md border border-line px-4 py-2.5 font-medium"
        >
          ← Program
        </Link>
      </header>

      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "model"} onChange={() => setMode("model")} />
          Pricing model
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "guidelines"} onChange={() => setMode("guidelines")} />
          Pasted guidelines
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "document"} onChange={() => setMode("document")} />
          Upload document
        </label>
      </div>

      {mode === "model" && (
        <section className="mb-8 flex flex-col gap-3">
          {MODEL_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-4">
              <span className="text-sm">{f.label}</span>
              <input
                type="number"
                value={model[f.key]}
                onChange={(e) => setModel((m) => ({ ...m, [f.key]: e.target.value }))}
                className="w-48 rounded-md border border-line px-3 py-2 text-base"
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
            className="w-full resize-y rounded-md border border-line px-3 py-2.5 text-base"
          />
        </section>
      )}

      {mode === "document" && (
        <section className="mb-8 flex flex-col gap-3">
          <p className="text-sm text-muted">
            Upload a rate sheet or pricing document (PDF, spreadsheet, etc.).
          </p>
          {currentFile && (
            <p className="text-sm">
              Current file: <span className="font-medium">{currentFile}</span>
            </p>
          )}
          <input ref={fileRef} type="file" className="text-sm" />
          <button
            onClick={uploadDoc}
            disabled={busy}
            className="self-start rounded-md bg-fg px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </section>
      )}

      {mode !== "document" && (
        <div className="flex items-center gap-4">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-fg px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save pricing"}
          </button>
          {msg && <span className="text-sm">{msg}</span>}
        </div>
      )}

      {mode === "document" && msg && <p className="text-sm">{msg}</p>}
    </main>
  );
}
