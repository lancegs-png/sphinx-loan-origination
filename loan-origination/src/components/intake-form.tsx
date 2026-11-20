"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createIntakeDeal } from "@/app/actions";
import { INTAKE_FORM_SPEC, type IntakeFieldSpec } from "@/lib/intake/form-spec";

/**
 * The native intake form (manual entry, Phase 1). One universal form for every deal type;
 * product-specific sections reveal based on the universal answers. On submit it opens an
 * Opportunity with the frozen Intake Form Data snapshot. See docs/intake-crm-design.md.
 */
export function IntakeForm() {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // Sections whose `when` predicate currently passes.
  const sections = useMemo(() => INTAKE_FORM_SPEC.filter((s) => !s.when || s.when(values)), [values]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    // Submit only the values for currently-visible fields, so hidden/irrelevant answers
    // (e.g. renovation type on a long-term deal) never reach the deal or the snapshot.
    const payload: Record<string, string> = {};
    for (const s of INTAKE_FORM_SPEC) {
      if (s.when && !s.when(values)) continue;
      for (const f of s.fields) {
        if (f.when && !f.when(values)) continue;
        const v = values[f.key];
        if (v != null && v.trim() !== "") payload[f.key] = v;
      }
    }
    const res = await createIntakeDeal(payload);
    if (res.ok && res.id) {
      router.push(`/loans/${res.id}`);
      return; // keep the form busy through navigation
    }
    setBusy(false);
    setError(res.error ?? "Could not create the deal.");
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-fg">New intake</h1>
        <p className="mt-1 text-sm text-muted">
          One form for every deal type — the right sections appear as you answer. Submitting opens an
          Opportunity and keeps a fixed snapshot of what was entered.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-6">
        {sections.map((section) => (
          <fieldset key={section.id} className="card p-5">
            <legend className="px-1 text-sm font-semibold text-fg">{section.title}</legend>
            {section.blurb && <p className="mb-3 text-xs text-muted">{section.blurb}</p>}
            <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {section.fields
                .filter((f) => !f.when || f.when(values))
                .map((f) => (
                  <Field key={f.key} spec={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
                ))}
            </div>
          </fieldset>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create opportunity"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  spec,
  value,
  onChange,
}: {
  spec: IntakeFieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `intake-${spec.key}`;
  // Textareas and full-width fields span both columns; half fields take one.
  const span = spec.type === "textarea" || !spec.half ? "sm:col-span-2" : "";

  return (
    <label htmlFor={id} className={`flex flex-col gap-1 ${span}`}>
      <span className="text-xs font-medium text-muted">
        {spec.label}
        {spec.required && <span className="ml-0.5 text-red-500">*</span>}
      </span>

      {spec.type === "select" ? (
        <select id={id} className="field" value={value} required={spec.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : spec.type === "textarea" ? (
        <textarea
          id={id}
          className="field min-h-20"
          value={value}
          required={spec.required}
          placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="field"
          type={inputType(spec.type)}
          inputMode={spec.type === "currency" || spec.type === "number" ? "decimal" : undefined}
          value={value}
          required={spec.required}
          placeholder={spec.placeholder ?? (spec.type === "currency" ? "$" : undefined)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {spec.help && <span className="text-[11px] leading-snug text-faint">{spec.help}</span>}
    </label>
  );
}

function inputType(t: IntakeFieldSpec["type"]): string {
  switch (t) {
    case "email":
      return "email";
    case "tel":
      return "tel";
    case "date":
      return "date";
    default:
      return "text"; // currency/number kept as text so "$" and commas are tolerated
  }
}
