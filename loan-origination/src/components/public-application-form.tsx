"use client";

import { useMemo, useState } from "react";
import { submitApplication } from "@/app/actions";
import { APPLICATION_FORM_SPEC } from "@/lib/application/form-spec";
import type { IntakeFieldSpec } from "@/lib/intake/form-spec";
import { SphinxLogo } from "@/components/brand";

/**
 * Public borrower Loan Application served at /application/<token> (no login), shown after the term
 * sheet is signed. Prefilled from the loan's current field values (all editable, so the borrower only
 * fills what's missing), with the same conditional logic and renderer as the intake form. Submits via
 * submitApplication, which writes the overlapping values back to the loan and saves a full snapshot.
 * (E-signature + the completed PDF land in phase 3.)
 */
export function PublicApplicationForm({
  token,
  initialValues,
}: {
  token: string;
  initialValues: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const sections = useMemo(() => APPLICATION_FORM_SPEC.filter((s) => !s.when || s.when(values)), [values]);

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
    for (const s of APPLICATION_FORM_SPEC) {
      if (s.when && !s.when(values)) continue;
      for (const f of s.fields) {
        if (f.when && !f.when(values)) continue;
        const v = values[f.key];
        if (v != null && v.trim() !== "") payload[f.key] = v;
      }
    }
    const res = await submitApplication({ token, values: payload, website });
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
          <SphinxLogo height={56} />
        </header>

        {done ? (
          <div className="card p-8 text-center">
            <h1 className="text-xl font-bold text-fg">Thank you — your application has been received.</h1>
            <p className="mt-2 text-sm text-muted">
              Your loan team will review it and follow up with next steps. You can close this page.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-bold text-fg">Loan Application</h1>
              <p className="mt-1 text-sm text-muted">
                We&apos;ve pre-filled everything we already have — please review it, correct anything that&apos;s
                changed, and complete the remaining fields. Required fields are marked with an asterisk.
              </p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-6">
              {/* Honeypot: visually hidden; bots fill it and get dropped. */}
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
                  {busy ? "Submitting…" : "Submit application"}
                </button>
              </div>

              <p className="text-center text-[11px] text-faint">
                By submitting, you confirm the information is true and complete to the best of your knowledge.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// Field renderer — mirrors the intake form's, so the two forms look and behave identically.
function Field({
  spec,
  value,
  onChange,
}: {
  spec: IntakeFieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `app-${spec.key}`;
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
