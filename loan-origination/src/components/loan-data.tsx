"use client";

import { useState, type ReactNode } from "react";
import { saveLoanField, setLoanFieldLock } from "@/app/actions";
import type { FieldDef, FieldValues, Loan } from "@/lib/types";

const SECTION_ORDER = ["loan", "property", "borrower", "guarantor", "contact", "trade"];
const SECTION_LABEL: Record<string, string> = {
  loan: "Loan",
  property: "Property",
  borrower: "Borrower",
  guarantor: "Guarantor",
  contact: "Contacts",
  trade: "Trade",
};

const str = (v: unknown) => (v == null ? "" : String(v));

export function LoanData({
  loan,
  fieldDefs,
  values,
  canEdit,
  isLender,
}: {
  loan: Loan;
  fieldDefs: FieldDef[];
  values: FieldValues;
  canEdit: boolean;
  isLender: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);

  // Hide trade/lender-only fields from non-lenders (RLS already omits their values).
  const defs = fieldDefs.filter((d) => isLender || (d.section !== "trade" && !d.lender_only));

  async function save(def: FieldDef, valueKind: "initial" | "verified", value: string) {
    const res = await saveLoanField({
      loanId: loan.id,
      key: def.key,
      type: def.type,
      value,
      valueKind,
    });
    setStatus(res.ok ? `Saved ${def.label}` : res.error ?? "Save failed");
  }

  async function toggleLock(def: FieldDef, locked: boolean) {
    const res = await setLoanFieldLock({ loanId: loan.id, key: def.key, locked });
    setStatus(res.ok ? (locked ? `Locked ${def.label}` : `Unlocked ${def.label}`) : res.error ?? "Failed");
  }

  return (
    <div className="flex flex-col gap-6">
      {!canEdit && <p className="text-xs text-muted">Read-only</p>}
      {SECTION_ORDER.map((section) => {
        const inSection = defs.filter((d) => d.section === section).sort((a, b) => a.sort - b.sort);
        if (inSection.length === 0) return null;
        return (
          <section key={section}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {SECTION_LABEL[section] ?? section}
            </h3>
            <div className="flex flex-col gap-3">
              {inSection.map((def) => (
                <FieldRow
                  key={def.key}
                  def={def}
                  cell={values[def.key]}
                  canEdit={canEdit}
                  isLender={isLender}
                  onSave={(kind, v) => save(def, kind, v)}
                  onLock={(locked) => toggleLock(def, locked)}
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
  def,
  cell,
  canEdit,
  isLender,
  onSave,
  onLock,
}: {
  def: FieldDef;
  cell: FieldValues[string] | undefined;
  canEdit: boolean;
  isLender: boolean;
  onSave: (kind: "initial" | "verified", value: string) => void;
  onLock: (locked: boolean) => void;
}) {
  const [initial, setInitial] = useState(str(cell?.initial));
  const [verified, setVerified] = useState(str(cell?.verified));
  const locked = cell?.locked ?? false;
  const calculated = def.source === "calculated";
  const current = str(cell?.current);

  // Calculated or read-only viewer: show the current value only.
  if (calculated || !canEdit) {
    return (
      <div>
        <div className="flex items-center gap-2 text-muted">
          {def.label}
          {calculated && <Badge>auto</Badge>}
        </div>
        <div className="font-medium">{current || "—"}</div>
      </div>
    );
  }

  const editable = !locked;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-muted">{def.label}</span>
        {def.verifiable && <Badge>verifiable</Badge>}
        {locked && <Badge tone="lock">locked</Badge>}
        {isLender && def.verifiable && (
          <button
            type="button"
            onClick={() => onLock(!locked)}
            className="ml-auto text-xs underline text-muted"
          >
            {locked ? "Unlock" : "Lock"}
          </button>
        )}
      </div>

      <div className={def.verifiable ? "grid grid-cols-2 gap-2" : ""}>
        <Input
          label={def.verifiable ? "Initial" : undefined}
          def={def}
          value={initial}
          baseline={str(cell?.initial)}
          setValue={setInitial}
          disabled={!editable}
          onCommit={(v) => onSave("initial", v)}
        />
        {def.verifiable && isLender && (
          <Input
            label="Verified"
            def={def}
            value={verified}
            baseline={str(cell?.verified)}
            setValue={setVerified}
            disabled={!editable}
            onCommit={(v) => onSave("verified", v)}
          />
        )}
      </div>
      {def.verifiable && <div className="text-xs text-muted">Current: {current || "—"}</div>}
    </div>
  );
}

function Input({
  label,
  def,
  value,
  baseline,
  setValue,
  disabled,
  onCommit,
}: {
  label?: string;
  def: FieldDef;
  value: string;
  baseline: string;
  setValue: (v: string) => void;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  const inputType = def.type === "date" ? "date" : def.type === "number" ? "number" : "text";
  return (
    <label className="flex flex-col gap-0.5">
      {label && <span className="text-xs text-muted">{label}</span>}
      {def.type === "select" ? (
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            onCommit(e.target.value);
          }}
          className="rounded-md border border-line px-2 py-1.5 text-sm disabled:opacity-50"
        >
          <option value="">—</option>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={inputType}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (value !== baseline) onCommit(value);
          }}
          className="rounded-md border border-line px-2 py-1.5 text-sm disabled:opacity-50"
        />
      )}
    </label>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone?: "lock" }) {
  return (
    <span
      className="rounded border border-line px-1 text-[10px] uppercase tracking-wide text-muted"
      style={tone === "lock" ? { color: "var(--status-outstanding)" } : undefined}
    >
      {children}
    </span>
  );
}
