"use client";

import { useState } from "react";
import { saveLoanField } from "@/app/actions";
import type { FieldDef, Loan } from "@/lib/types";

const CORE_KEYS = [
  "loan_number",
  "loan_type",
  "loan_amount",
  "property_address",
  "borrower_name",
  "expected_close_date",
];

const SECTION_ORDER = ["loan", "property", "borrower", "guarantor", "trade", "other"];
const SECTION_LABEL: Record<string, string> = {
  loan: "Loan",
  property: "Property",
  borrower: "Borrower",
  guarantor: "Guarantor",
  trade: "Trade",
  other: "Other (captured)",
};

export function LoanData({
  loan,
  fieldDefs,
  customFields,
  tradeValues,
  canEdit,
  isLender,
}: {
  loan: Loan;
  fieldDefs: FieldDef[];
  customFields: Record<string, unknown>;
  tradeValues: Record<string, unknown>;
  canEdit: boolean;
  isLender: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);

  const coreMap: Record<string, unknown> = {
    loan_number: loan.loan_number,
    loan_type: loan.loan_type,
    loan_amount: loan.loan_amount,
    property_address: loan.property_address,
    borrower_name: loan.borrower_name,
    expected_close_date: loan.expected_close_date,
  };

  function valueFor(def: FieldDef): string {
    let v: unknown;
    if (CORE_KEYS.includes(def.key)) v = coreMap[def.key];
    else if (def.section === "trade") v = tradeValues[def.key];
    else v = customFields[def.key];
    return v == null ? "" : String(v);
  }

  async function save(key: string, section: string, value: string, label: string) {
    const res = await saveLoanField({ loanId: loan.id, key, section, value });
    setStatus(res.ok ? `Saved ${label}` : res.error ?? "Save failed");
  }

  // Dictionary fields the viewer can see (hide trade from non-lenders).
  const defs = fieldDefs.filter((d) => isLender || d.section !== "trade");

  // Captured custom_fields not covered by the dictionary → "other".
  const dictKeys = new Set(fieldDefs.map((d) => d.key));
  const otherKeys = Object.keys(customFields).filter((k) => !dictKeys.has(k) && !CORE_KEYS.includes(k));

  return (
    <div className="flex flex-col gap-6">
      {!canEdit && <p className="text-xs text-muted">Read-only</p>}
      {SECTION_ORDER.map((section) => {
        const inSection = defs.filter((d) => d.section === section).sort((a, b) => a.sort - b.sort);
        const extra = section === "other" ? otherKeys : [];
        if (inSection.length === 0 && extra.length === 0) return null;
        return (
          <section key={section}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {SECTION_LABEL[section]}
            </h3>
            <div className="flex flex-col gap-3">
              {inSection.map((def) => (
                <FieldRow
                  key={def.key}
                  label={def.label}
                  type={def.type}
                  options={def.options}
                  initial={valueFor(def)}
                  readOnly={!canEdit || def.key === "loan_number"}
                  onSave={(v) => save(def.key, def.section, v, def.label)}
                />
              ))}
              {extra.map((k) => (
                <FieldRow
                  key={k}
                  label={prettyKey(k)}
                  type="text"
                  options={[]}
                  initial={customFields[k] == null ? "" : String(customFields[k])}
                  readOnly={!canEdit}
                  onSave={(v) => save(k, "other", v, prettyKey(k))}
                />
              ))}
            </div>
          </section>
        );
      })}
      {status && <p className="text-xs text-muted">{status}</p>}
    </div>
  );
}

function FieldRow({
  label,
  type,
  options,
  initial,
  readOnly,
  onSave,
}: {
  label: string;
  type: FieldDef["type"];
  options: string[];
  initial: string;
  readOnly: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);

  const commit = () => {
    if (value !== initial) onSave(value);
  };

  if (readOnly) {
    return (
      <div>
        <div className="text-muted">{label}</div>
        <div className="font-medium">{value || "—"}</div>
      </div>
    );
  }

  const inputType = type === "date" ? "date" : type === "text" || type === "select" ? "text" : "number";

  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      {type === "select" ? (
        <select
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value !== initial) onSave(e.target.value);
          }}
          className="rounded-md border border-line px-2 py-1.5 text-sm"
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={inputType}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          className="rounded-md border border-line px-2 py-1.5 text-sm"
        />
      )}
    </label>
  );
}

function prettyKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
