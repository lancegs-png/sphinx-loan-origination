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
    <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
      <Link href="/admin" className="text-sm text-muted transition-colors hover:text-fg">
        ← Settings
      </Link>
      <header className="mb-6 mt-3">
        <h1 className="text-[1.75rem] font-bold text-fg">{programName}</h1>
        <p className="mt-1 text-sm text-muted">AI intake configuration</p>
      </header>

      <nav className="mb-8 flex flex-wrap gap-2 text-sm">
        <span className="chip bg-navy/[0.06] text-navy">AI Intake</span>
        <Link href={`/admin/programs/${programId}/checklist`} className="chip transition-colors hover:text-fg">
          Checklist
        </Link>
        <Link href={`/admin/programs/${programId}/pricing`} className="chip transition-colors hover:text-fg">
          Pricing
        </Link>
      </nav>

      {/* Quote fields */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold text-fg">Quote inputs</h2>
        <p className="mb-4 text-sm text-muted">
          What the AI must gather for an initial quote on this program.
        </p>

        <ul className="mb-4 flex flex-col gap-2">
          {fields.length === 0 && <li className="text-sm text-muted">No quote fields yet.</li>}
          {fields.map((f, i) => (
            <li key={f.key} className="card px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-fg">
                  {f.label} <span className="text-muted">({f.key})</span>
                </span>
                <button
                  onClick={() => setFields((arr) => arr.filter((_, idx) => idx !== i))}
                  className="btn btn-ghost text-sm text-[var(--status-outstanding)]"
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  Type
                  <select
                    value={f.type ?? "text"}
                    onChange={(e) =>
                      setFields((arr) =>
                        arr.map((x, idx) =>
                          idx === i
                            ? {
                                ...x,
                                type: e.target.value as QuoteField["type"],
                                options: e.target.value === "select" ? (x.options ?? []) : undefined,
                              }
                            : x,
                        ),
                      )
                    }
                    className="field select w-auto"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="date">Date</option>
                    <option value="select">Dropdown</option>
                  </select>
                </label>
                {f.type === "select" && (
                  <input
                    value={(f.options ?? []).join(", ")}
                    onChange={(e) =>
                      setFields((arr) =>
                        arr.map((x, idx) =>
                          idx === i
                            ? {
                                ...x,
                                options: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              }
                            : x,
                        ),
                      )
                    }
                    placeholder="Options, comma-separated"
                    className="field flex-1"
                  />
                )}
                <label className="flex items-center gap-1.5 text-muted">
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
              </div>
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
            className="field flex-1"
          />
          <button onClick={addField} className="btn btn-secondary">
            Add field
          </button>
        </div>
      </section>

      {/* Intake style */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold text-fg">Intake style</h2>
        <p className="mb-4 text-sm text-muted">Voice, tone, and guardrails for how the AI asks.</p>
        <textarea
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          rows={5}
          placeholder="e.g. Warm and concise. Ask one question at a time. Never quote a rate. Always confirm the exact entity name."
          className="field w-full resize-y"
        />
      </section>

      {/* Example conversations */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold text-fg">Example conversations</h2>
        <p className="mb-4 text-sm text-muted">
          Paste ideal intake exchanges; the AI mirrors this phrasing and flow.
        </p>
        <textarea
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
          rows={8}
          placeholder={"AI: Are you the borrower or an originator?\nUser: Originator, John at ABC.\nAI: Great — who's the borrower?"}
          className="field w-full resize-y"
        />
      </section>

      <div className="flex items-center gap-4">
        <button onClick={save} disabled={busy} className="btn btn-primary">
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </main>
  );
}
