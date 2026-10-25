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
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3 rounded-md border border-line p-4">
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
              className="rounded-md border border-line px-3 py-2 text-base"
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
              className="rounded-md border border-line px-3 py-2 text-base"
            />
          )}
        </label>
      ))}
      <button
        type="submit"
        disabled={disabled}
        className="self-start rounded-md bg-fg px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Submit
      </button>
    </form>
  );
}
