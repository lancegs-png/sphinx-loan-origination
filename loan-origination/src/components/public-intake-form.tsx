"use client";

import { useMemo, useState } from "react";
import { submitPublicIntake } from "@/app/actions";
import { INTAKE_FORM_SPEC, type IntakeFieldSpec } from "@/lib/intake/form-spec";

/**
 * Public intake form served at /apply/<token> (no login). Same fields and conditional logic
 * as the internal form, plus a brand header (Sphinx or white-label — no Sphinx identity), a
 * honeypot, and a thank-you state instead of a redirect. Submits via submitPublicIntake.
 */
export function PublicIntakeForm({ token, branding }: { token: string; branding: "sphinx" | "white_label" }) {
  const sphinx = branding === "sphinx";
  const [values, setValues] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const sections = useMemo(() => INTAKE_FORM_SPEC.filter((s) => !s.when || s.when(values)), [values]);

  function set(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    // Only the currently-visible fields.
    const payload: Record<string, string> = {};
    for (const s of INTAKE_FORM_SPEC) {
      if (s.when && !s.when(values)) continue;
      for (const f of s.fields) {
        if (f.when && !f.when(values)) continue;
        const v = values[f.key];
        if (v != null && v.trim() !== "") payload[f.key] = v;
      }
    }
    const res = await submitPublicIntake({ token, values: payload, website });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    setError(res.error ?? "Something went wrong. Please try again.");
  }

  return (
    <div className="min-h-screen bg-surface-2 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          {sphinx ? (
            <div className="text-lg font-bold tracking-tight text-navy">Sphinx Capital</div>
          ) : (
            <div className="text-lg font-bold tracking-tight text-fg">Loan Application</div>
          )}
        </header>

        {done ? (
          <div className="card p-8 text-center">
            <h1 className="text-xl font-bold text-fg">Thank you — your submission has been received.</h1>
            <p className="mt-2 text-sm text-muted">
              We&apos;ll review your scenario and be in touch shortly. You can close this page.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-bold text-fg">Loan scenario intake</h1>
              <p className="mt-1 text-sm text-muted">
                Thank you for your interest{sphinx ? " in our loan programs" : ""}. Please complete the form as
                thoroughly as possible — the more accurate the information, the faster we can help. The right
                sections appear as you answer.
              </p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-6">
              {/* Honeypot: visually hidden, ignored by real users; bots fill it and get dropped. */}
              <div aria-hidden className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden" tabIndex={-1}>
                <label>
                  Company website
                  <input
                    type="text"
                    name="website"
                    autoComplete="off"
                    tabIndex={-1}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </div>

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
                  {busy ? "Submitting…" : "Submit"}
                </button>
              </div>

              <p className="text-center text-[11px] text-faint">
                By submitting, you agree to be contacted about this property or project.
              </p>
            </form>
          </>
        )}
      </div>
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
  const id = `apply-${spec.key}`;
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
          type={spec.type === "email" ? "email" : spec.type === "tel" ? "tel" : spec.type === "date" ? "date" : "text"}
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
