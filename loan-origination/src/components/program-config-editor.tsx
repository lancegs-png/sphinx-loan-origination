"use client";

import { useState } from "react";
import Link from "next/link";
import { saveProgramAiConfig } from "@/app/actions";
import type { QuoteField } from "@/lib/ai/intake";

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function ProgramConfigEditor({
  programId,
  programName,
  initialQuoteFields,
  initialStyle,
  initialExamples,
}: {
  programId: string;
  programName: string;
  initialQuoteFields: QuoteField[];
  initialStyle: string;
  initialExamples: string;
}) {
  const [fields, setFields] = useState<QuoteField[]>(initialQuoteFields);
  const [style, setStyle] = useState(initialStyle);
  const [examples, setExamples] = useState(initialExamples);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function addField() {
    const label = newLabel.trim();
    if (!label) return;
    const key = slug(label);
    if (!key || fields.some((f) => f.key === key)) return;
    setFields((f) => [...f, { key, label, required: true }]);
    setNewLabel("");
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await saveProgramAiConfig({
      programId,
      quoteFields: fields,
      intakeStyle: style,
      intakeExamples: examples,
    });
    setBusy(false);
    setMsg(res.ok ? "Saved." : res.error ?? "Save failed.");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{programName}</h1>
          <p className="text-muted">AI intake configuration</p>
        </div>
        <Link href="/admin" className="rounded-md border border-line px-4 py-2.5 font-medium">
          ← Programs
        </Link>
      </header>

      {/* Quote fields */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Quote inputs</h2>
        <p className="mb-4 text-sm text-muted">
          What the AI must gather for an initial quote on this program.
        </p>

        <ul className="mb-4 flex flex-col gap-2">
          {fields.length === 0 && <li className="text-sm text-muted">No quote fields yet.</li>}
          {fields.map((f, i) => (
            <li
              key={f.key}
              className="flex items-center justify-between rounded-md border border-line px-3 py-2.5"
            >
              <span>
                {f.label} <span className="text-muted">({f.key})</span>
              </span>
              <span className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={f.required ?? false}
                    onChange={() =>
                      setFields((arr) =>
                        arr.map((x, idx) => (idx === i ? { ...x, required: !x.required } : x)),
                      )
                    }
                  />
                  required
                </label>
                <button
                  onClick={() => setFields((arr) => arr.filter((_, idx) => idx !== i))}
                  className="text-sm text-muted underline"
                >
                  remove
                </button>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex gap-3">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addField();
              }
            }}
            placeholder="e.g. Monthly rent"
            className="flex-1 rounded-md border border-line px-3 py-2.5 text-base"
          />
          <button onClick={addField} className="rounded-md border border-line px-4 py-2.5 font-medium">
            Add field
          </button>
        </div>
      </section>

      {/* Intake style */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Intake style</h2>
        <p className="mb-4 text-sm text-muted">Voice, tone, and guardrails for how the AI asks.</p>
        <textarea
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          rows={5}
          placeholder="e.g. Warm and concise. Ask one question at a time. Never quote a rate. Always confirm the exact entity name."
          className="w-full resize-y rounded-md border border-line px-3 py-2.5 text-base"
        />
      </section>

      {/* Example conversations */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Example conversations</h2>
        <p className="mb-4 text-sm text-muted">
          Paste ideal intake exchanges; the AI mirrors this phrasing and flow.
        </p>
        <textarea
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
          rows={8}
          placeholder={"AI: Are you the borrower or an originator?\nUser: Originator, John at ABC.\nAI: Great — who's the borrower?"}
          className="w-full resize-y rounded-md border border-line px-3 py-2.5 text-base"
        />
      </section>

      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-fg px-5 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </main>
  );
}
