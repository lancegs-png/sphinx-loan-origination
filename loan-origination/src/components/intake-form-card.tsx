"use client";

import { useState } from "react";
import type { FormFieldSpec } from "@/lib/types";

export function IntakeFormCard({
  form,
  disabled,
  onSubmit,
}: {
  form: { intro?: string; fields: FormFieldSpec[] };
  disabled?: boolean;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  function set(key: string, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={submit} className="card mt-2.5 flex flex-col gap-3 p-4">
      {form.fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            {f.label}
            {f.required ? " *" : ""}
          </span>
          {f.type === "select" ? (
            <select
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              disabled={disabled}
              className="field select w-full"
            >
              <option value="">Select…</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={
                f.type === "number" || f.type === "currency"
                  ? "number"
                  : f.type === "date"
                    ? "date"
                    : "text"
              }
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              disabled={disabled}
              className="field w-full"
            />
          )}
        </label>
      ))}
      <button type="submit" disabled={disabled} className="btn btn-primary self-start">
        Submit
      </button>
    </form>
  );
}
