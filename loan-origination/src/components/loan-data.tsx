"use client";

import { useState, type ReactNode } from "react";
import { saveLoanField, setLoanFieldLock, syncLoanToSheet } from "@/app/actions";
import type { FieldDef, FieldValues, Loan } from "@/lib/types";

// Left column holds the other sections; the right column holds the curated Loan Info
// card and its overflow ("Additional Loan Info"). Contacts live on the People tab.
const LEFT_SECTIONS = ["property", "borrower", "guarantor", "trade"];
const SECTION_LABEL: Record<string, string> = {
  property: "Property Info",
  borrower: "Borrower Info",
  guarantor: "Guarantor",
  trade: "Trade Info",
};

// The curated Loan Info card: these keys (with short labels), in this order. Everything
// else in the loan section drops to the "Additional Loan Info" card below it.
const PRIMARY_LOAN: { key: string; label: string }[] = [
  { key: "application_date", label: "Start Date" },
  { key: "product_type", label: "Product Type" },
  { key: "loan_amount", label: "Loan Amount" },
  { key: "loan_purpose", label: "Loan Purpose" },
  { key: "interest_rate", label: "Rate" },
  { key: "prepay_term_months", label: "Prepay Term" },
  { key: "prepay_type", label: "Prepay Type" },
  { key: "ltv", label: "Leverage" },
  { key: "origination_fee_pct", label: "Origination" },
  { key: "loan_term_months", label: "Loan Term" },
  { key: "as_is_value", label: "Appraised Value" },
  { key: "io_months", label: "Interest Only Months" },
];
const PRIMARY_LOAN_KEYS = new Set(PRIMARY_LOAN.map((p) => p.key));

const str = (v: unknown) => (v == null ? "" : String(v));

/** Read-only display: currency with a $ and thousands separators, percent with a %. */
function fmtDisplay(def: FieldDef, v: string): string {
  if (!v) return "—";
  if (def.type === "currency") {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? `$${Math.round(n).toLocaleString("en-US")}` : v;
  }
  if (def.type === "percent") return /%\s*$/.test(v) ? v : `${v}%`;
  return v;
}

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

  const byKey = new Map(defs.map((d) => [d.key, d]));

  function cardShell(key: string, title: string, children: ReactNode) {
    return (
      <section key={key} className="card overflow-hidden">
        <h3 className="border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          {title}
        </h3>
        <div className="divide-y divide-line">{children}</div>
      </section>
    );
  }

  function row(def: FieldDef, label?: string) {
    return (
      <FieldRow
        key={def.key}
        def={label ? { ...def, label } : def}
        cell={values[def.key]}
        canEdit={canEdit}
        isLender={isLender}
        onSave={(kind, v) => save(def, kind, v)}
        onLock={(locked) => toggleLock(def, locked)}
      />
    );
  }

  // Non-loan sections, minus any field pulled into the curated Loan Info card.
  function sectionCard(section: string) {
    const inSection = defs
      .filter((d) => d.section === section && !PRIMARY_LOAN_KEYS.has(d.key))
      .sort((a, b) => a.sort - b.sort);
    if (inSection.length === 0) return null;
    return cardShell(section, SECTION_LABEL[section] ?? section, inSection.map((d) => row(d)));
  }

  // Curated Loan Info card: a read-only Loan Number pulled from the loan record, then
  // the chosen fields in order.
  const loanCard = cardShell(
    "loan",
    "Loan Info",
    <>
      <Row label="Loan Number">
        <span className="block truncate px-2 py-1.5 text-sm text-fg">
          {loan.loan_number ?? loan.opportunity_number ?? "—"}
        </span>
      </Row>
      {PRIMARY_LOAN.map((p) => {
        const def = byKey.get(p.key);
        return def ? row(def, p.label) : null;
      })}
    </>,
  );

  // Everything else in the loan section → Additional Loan Info.
  const additional = defs
    .filter((d) => d.section === "loan" && !PRIMARY_LOAN_KEYS.has(d.key))
    .sort((a, b) => a.sort - b.sort);
  const additionalCard = additional.length
    ? cardShell("additional_loan", "Additional Loan Info", additional.map((d) => row(d)))
    : null;

  return (
    <div className="flex flex-col gap-3">
      {!canEdit && <p className="text-xs text-muted">Read-only</p>}
      {canEdit && <SheetSync loanId={loan.id} />}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-3">{LEFT_SECTIONS.map(sectionCard)}</div>
        <div className="flex flex-col gap-3">
          {loanCard}
          {additionalCard}
        </div>
      </div>
      {status && <p className="text-xs text-muted">{status}</p>}
    </div>
  );
}

/** One dense spreadsheet-style row: a label cell on the left, the value/editor on the right. */
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
  const locked = cell?.locked ?? false;
  const calculated = def.source === "calculated";
  const current = str(cell?.current);
  const showLock = canEdit && isLender && def.verifiable;

  // Calculated or read-only viewer: label | value.
  if (calculated || !canEdit) {
    return (
      <Row label={def.label} badge={calculated ? "auto" : undefined}>
        <span className="block truncate px-2 py-1.5 text-sm text-fg">{fmtDisplay(def, current)}</span>
      </Row>
    );
  }

  // Verifiable (lender): Initial | Verified side by side in the value cell.
  if (def.verifiable && isLender) {
    return (
      <Row label={def.label} locked={locked} onLock={() => onLock(!locked)} showLock={showLock}>
        <div className="grid grid-cols-2 divide-x divide-line">
          <CellInput def={def} base={str(cell?.initial)} disabled={locked} placeholder="Initial" onCommit={(v) => onSave("initial", v)} />
          <CellInput def={def} base={str(cell?.verified)} disabled={locked} placeholder="Verified" onCommit={(v) => onSave("verified", v)} />
        </div>
      </Row>
    );
  }

  // Editable single value.
  return (
    <Row label={def.label} locked={locked}>
      <CellInput def={def} base={str(cell?.initial)} disabled={locked} onCommit={(v) => onSave("initial", v)} />
    </Row>
  );
}

function Row({
  label,
  children,
  badge,
  locked,
  onLock,
  showLock,
}: {
  label: string;
  children: ReactNode;
  badge?: string;
  locked?: boolean;
  onLock?: () => void;
  showLock?: boolean;
}) {
  return (
    <div className="grid grid-cols-[42%_1fr] items-stretch">
      <div className="flex items-center gap-1 border-r border-line bg-surface-2/50 px-2.5 py-1.5">
        <span className="truncate text-xs text-muted" title={label}>
          {label}
        </span>
        {badge && <span className="chip px-1 py-0 text-[9px] uppercase">{badge}</span>}
        {locked && (
          <span aria-hidden title="Locked" className="text-[10px]" style={{ color: "var(--status-outstanding)" }}>
            🔒
          </span>
        )}
        {showLock && onLock && (
          <button
            type="button"
            onClick={onLock}
            className="ml-auto text-[10px] text-faint underline hover:text-fg"
          >
            {locked ? "Unlock" : "Lock"}
          </button>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Borderless cell editor (text/number/date/select) that fills its grid cell. Commits on blur/change. */
function CellInput({
  def,
  base,
  disabled,
  placeholder,
  onCommit,
}: {
  def: FieldDef;
  base: string;
  disabled: boolean;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [value, setValue] = useState(base);
  const cls =
    "w-full bg-transparent px-2 py-1.5 text-sm text-fg outline-none focus:bg-gold/5 disabled:opacity-50";

  if (def.type === "select") {
    return (
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          onCommit(e.target.value);
        }}
        className={`${cls} appearance-none`}
      >
        <option value="">—</option>
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  const inputType = def.type === "date" ? "date" : def.type === "number" ? "number" : "text";
  const prefix = def.type === "currency" ? "$" : null;
  const suffix = def.type === "percent" ? "%" : null;

  const input = (
    <input
      type={inputType}
      inputMode={def.type === "currency" || def.type === "percent" ? "decimal" : undefined}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== base) onCommit(value);
      }}
      className={`w-full bg-transparent py-1.5 text-sm text-fg outline-none disabled:opacity-50 ${
        prefix ? "pl-1" : "pl-2"
      } ${suffix ? "pr-1" : "pr-2"}`}
    />
  );

  if (!prefix && !suffix) {
    // No adornment: let the input fill the cell and show the focus tint itself.
    return (
      <input
        type={inputType}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== base) onCommit(value);
        }}
        className={cls}
      />
    );
  }

  return (
    <div className="flex items-center focus-within:bg-gold/5">
      {prefix && <span className="pl-2 text-sm text-muted">{prefix}</span>}
      {input}
      {suffix && <span className="pr-2 text-sm text-muted">{suffix}</span>}
    </div>
  );
}

function SheetSync({ loanId }: { loanId: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function sync() {
    setBusy(true);
    setErr(null);
    const res = await syncLoanToSheet(loanId);
    setBusy(false);
    if (res.ok) setUrl(res.url ?? null);
    else setErr(res.error ?? "Sync failed.");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button onClick={sync} disabled={busy} className="btn btn-secondary text-xs">
        {busy ? "Syncing…" : "Sync to Google Sheet"}
      </button>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-navy underline underline-offset-2">
          Open sheet
        </a>
      )}
      {err && <span style={{ color: "var(--status-outstanding)" }}>{err}</span>}
    </div>
  );
}
