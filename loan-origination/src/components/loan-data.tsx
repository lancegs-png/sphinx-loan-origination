"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { saveLoanField, setLoanFieldLock, syncLoanToSheet } from "@/app/actions";
import type { FieldDef, FieldValues, Loan } from "@/lib/types";

// Section cards, labelled and ordered to mirror the DSCR dashboard's Loan Data tab.
// Data Tape Fields holds the columns the tape adds on top of Loan Data; Additional Info
// holds everything the dashboard doesn't track (operational + RTL fields).
const SECTION_LABEL: Record<string, string> = {
  loan: "Loan Info",
  property: "Property Info",
  trade: "Trade Info",
  borrower: "Borrower Info",
  contact: "Contacts",
  closing: "Closing Calculations",
  data_tape: "Data Tape Fields",
  additional: "Additional Info",
};

// Short display labels matching the dashboard's wording (overrides the stored field label).
const DASHBOARD_LABEL: Record<string, string> = {
  application_date: "Start Date",
  product_type: "Product Type",
  loan_amount: "Loan Amount",
  loan_purpose: "Loan Purpose",
  interest_rate: "Rate",
  prepay_term_months: "Prepay Term",
  prepay_type: "Prepay Type",
  ltv: "LTV",
  origination_fee_pct: "Origination",
  loan_term_months: "Loan Term",
  reserve_months: "Reserve Months",
  io_months: "Interest Only Months",
  as_is_value: "As-Is Value",
  guarantor_fico: "Guarantor Credit",
};

// Verifiable fields shown as a single value (current = verified ?? initial; edits write
// to verified) instead of the Initial/Verified pair — like the property fields. Populated
// with the intake/initial value, then shows the verified value once it's updated.
const SINGLE_VALUE_KEYS = new Set([
  "loan_purpose",
  "interest_rate",
  "ltv",
  "origination_fee_pct",
  "borrower_entity",
  "entity_ein",
  "entity_state",
  "guarantor_first_name",
  "guarantor_last_name",
  "guarantor_fico",
  "guarantor_citizenship",
  "guarantor_ownership_pct",
]);

// Only these fields get the lock / unlock control.
const LOCKABLE_KEYS = new Set(["interest_rate", "ltv", "origination_fee_pct"]);

const str = (v: unknown) => (v == null ? "" : String(v));

/** Read-only display: currency with a $ and thousands separators, percent with a %. */
function fmtDisplay(def: FieldDef, v: string): string {
  if (!v) return "—";
  if (def.type === "currency") {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return v;
    // Two decimals when there are cents ($1,128.35); drop them when whole ($157,500).
    const minimumFractionDigits = Number.isInteger(n) ? 0 : 2;
    return `$${n.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits: 2 })}`;
  }
  if (def.type === "percent") return /%\s*$/.test(v) ? v : `${v}%`;
  return v;
}

/** Format a stored YYYY-MM-DD date as MM/DD/YYYY (no timezone shift). */
function fmtMMDDYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
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

  // Hide the internal sections (trade / closing / data tape) and any lender-only field
  // from non-lenders (RLS already omits their values).
  const INTERNAL_SECTIONS = new Set(["trade", "closing", "data_tape"]);
  const defs = fieldDefs.filter((d) => isLender || (!INTERNAL_SECTIONS.has(d.section) && !d.lender_only));

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

  function row(def: FieldDef) {
    const label = DASHBOARD_LABEL[def.key];
    return (
      <FieldRow
        key={def.key}
        def={label ? { ...def, label } : def}
        cell={values[def.key]}
        canEdit={canEdit}
        isLender={isLender}
        singleValue={def.section === "property" || SINGLE_VALUE_KEYS.has(def.key)}
        onSave={(kind, v) => save(def, kind, v)}
        onLock={(locked) => toggleLock(def, locked)}
      />
    );
  }

  // One card per section, fields in the stored sort order. The Loan Info card leads with
  // the read-only Loan Number pulled from the loan record.
  function sectionCard(section: string) {
    const inSection = defs.filter((d) => d.section === section).sort((a, b) => a.sort - b.sort);
    if (inSection.length === 0) return null;
    return cardShell(
      section,
      SECTION_LABEL[section] ?? section,
      <>
        {section === "loan" && (
          <Row label="Loan Number">
            <span className="block truncate px-2 py-1.5 text-sm text-fg">
              {loan.loan_number ?? loan.opportunity_number ?? "—"}
            </span>
          </Row>
        )}
        {inSection.map((d) => row(d))}
      </>,
    );
  }

  // Initial Property Data: the original (intake) values for property fields, read-only.
  // The live Property card shows the current value (verified once set, else initial).
  const propInitials = defs
    .filter((d) => d.section === "property" && d.verifiable)
    .sort((a, b) => a.sort - b.sort);
  const initialCard =
    isLender && propInitials.length
      ? cardShell(
          "initial_property",
          "Initial Property Data",
          propInitials.map((d) => (
            <Row key={d.key} label={DASHBOARD_LABEL[d.key] ?? d.label}>
              <span className="block truncate px-2 py-1.5 text-sm text-muted">
                {fmtDisplay(d, str(values[d.key]?.initial))}
              </span>
            </Row>
          )),
        )
      : null;

  return (
    <div className="flex flex-col gap-3">
      {!canEdit && <p className="text-xs text-muted">Read-only</p>}
      {canEdit && <SheetSync loanId={loan.id} />}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {sectionCard("loan")}
          {sectionCard("property")}
          {initialCard}
        </div>
        <div className="flex flex-col gap-3">
          {sectionCard("trade")}
          {sectionCard("borrower")}
          {sectionCard("contact")}
          {sectionCard("closing")}
        </div>
      </div>
      {sectionCard("data_tape")}
      {sectionCard("additional")}
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
  singleValue,
  onSave,
  onLock,
}: {
  def: FieldDef;
  cell: FieldValues[string] | undefined;
  canEdit: boolean;
  isLender: boolean;
  singleValue?: boolean;
  onSave: (kind: "initial" | "verified", value: string) => void;
  onLock: (locked: boolean) => void;
}) {
  const locked = cell?.locked ?? false;
  const calculated = def.source === "calculated";
  const current = str(cell?.current);
  const showLock = canEdit && isLender && def.verifiable && LOCKABLE_KEYS.has(def.key);

  // Term sheet / commitment letter dates are auto-stamped when the document is
  // generated (read-only here) and reflect the most recent generation. Until the first
  // generation they preview as today (MM/DD/YYYY), so the document reads as ready to
  // download; the stored value is set to the actual generation date on download.
  if (def.key === "term_sheet_date" || def.key === "commitment_date") {
    const iso = current || new Date().toISOString().slice(0, 10);
    return (
      <Row label={def.label} badge="auto">
        <span className="block truncate px-2 py-1.5 text-sm text-fg">{fmtMMDDYYYY(iso)}</span>
      </Row>
    );
  }

  // Calculated or read-only viewer: label | value.
  if (calculated || !canEdit) {
    return (
      <Row label={def.label} badge={calculated ? "auto" : undefined}>
        <span className="block truncate px-2 py-1.5 text-sm text-fg">{fmtDisplay(def, current)}</span>
      </Row>
    );
  }

  // Verifiable (lender). Single-value mode shows just the current value (initial until a
  // verified value is set) and edits write to verified; the original initial is preserved
  // and shown read-only in the "Initial Property Data" card.
  if (def.verifiable && isLender) {
    if (singleValue) {
      return (
        <Row label={def.label} locked={locked} onLock={() => onLock(!locked)} showLock={showLock}>
          <CellInput def={def} base={current} disabled={locked} onCommit={(v) => onSave("verified", v)} />
        </Row>
      );
    }
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
  const isCurrency = def.type === "currency";
  // Currency fields display with thousands separators and two decimals ($xxx,xxx.00).
  const fmtCurrency = (s: string): string => {
    if (s.trim() === "") return "";
    const n = Number(s.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return s;
    const minimumFractionDigits = Number.isInteger(n) ? 0 : 2;
    return n.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits: 2 });
  };
  const [value, setValue] = useState(isCurrency ? fmtCurrency(base) : base);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Commit on blur. For currency, reformat to $xxx,xxx.00 and only save when the
  // numeric amount actually changed (so re-formatting doesn't trigger a redundant save).
  const commit = () => {
    if (isCurrency) {
      const n = Number(value.replace(/[^0-9.-]/g, ""));
      const baseN = Number(String(base).replace(/[^0-9.-]/g, ""));
      const formatted = fmtCurrency(value);
      if (formatted !== value) setValue(formatted);
      const changed = value.trim() === "" ? String(base).trim() !== "" : n !== baseN;
      if (changed) onCommit(formatted);
      return;
    }
    if (value !== base) onCommit(value);
  };
  const cls =
    "w-full bg-transparent px-2 py-1.5 text-sm text-fg outline-none focus:bg-gold/5 disabled:opacity-50";

  // Auto-grow a long-text field so the full entry stays visible.
  useEffect(() => {
    const el = taRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  if (def.key === "loan_request_summary") {
    return (
      <textarea
        ref={taRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== base) onCommit(value);
        }}
        className={`${cls} resize-none overflow-hidden leading-snug`}
      />
    );
  }

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
      onBlur={commit}
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
