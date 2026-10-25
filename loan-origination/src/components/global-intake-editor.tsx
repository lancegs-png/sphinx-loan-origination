"use client";

import { useState } from "react";
import Link from "next/link";
import { saveGlobalIntakeConfig } from "@/app/actions";
import type { QuoteField } from "@/lib/ai/intake";

export function GlobalIntakeEditor({
  initialBaseFields,
  initialStyle,
  initialExamples,
}: {
  initialBaseFields: QuoteField[];
  initialStyle: string;
  initialExamples: string;
}) {
  const [fields, setFields] = useState<QuoteField[]>(initialBaseFields);
  const [style, setStyle] = useState(initialStyle);
  const [examples, setExamples] = useState(initialExamples);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function slug(s: string) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

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
    const res = await saveGlobalIntakeConfig({ baseFields: fields, style, examples });
    setBusy(false);
    setMsg(res.ok ? "Saved." : res.error ?? "Save failed.");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Global Intake</h1>
          <p className="text-muted">
            The opening conversation — used before a loan program is known.
          </p>
        </div>
        <Link href="/admin" className="rounded-md border border-line px-4 py-2.5 font-medium">
          ← Admin
        </Link>
      </header>

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Opening questions</h2>
        <p className="mb-4 text-sm text-muted">
          What the AI gathers first, before loan-type-specific questions.
        </p>

        <ul className="mb-4 flex flex-col gap-2">
          {fields.length === 0 && <li className="text-sm text-muted">No opening questions yet.</li>}
          {fields.map((f, i) => (
            <li key={f.key} className="rounded-md border border-line px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span>{f.label}</span>
                <button
                  onClick={() => setFields((arr) => arr.filter((_, idx) => idx !== i))}
                  className="text-sm text-muted underline"
                >
                  remove
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
                    className="rounded-md border border-line px-2 py-1"
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
                    className="flex-1 rounded-md border border-line px-2 py-1"
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
            placeholder="e.g. Are you the borrower or an originator?"
            className="flex-1 rounded-md border border-line px-3 py-2.5 text-base"
          />
          <button onClick={addField} className="rounded-md border border-line px-4 py-2.5 font-medium">
            Add question
          </button>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Default intake style</h2>
        <p className="mb-4 text-sm text-muted">
          Voice and guardrails for every intake (a program can override this).
        </p>
        <textarea
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          rows={5}
          placeholder="e.g. Warm and concise. One question at a time. Never quote a rate."
          className="w-full resize-y rounded-md border border-line px-3 py-2.5 text-base"
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Default example conversations</h2>
        <p className="mb-4 text-sm text-muted">Ideal opening exchanges the AI should mirror.</p>
        <textarea
          value={examples}
          onChange={(e) => setExamples(e.target.value)}
          rows={8}
          placeholder={"AI: Are you the borrower or an originator?\nUser: Borrower.\nAI: Great — and who is the borrower?"}
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
