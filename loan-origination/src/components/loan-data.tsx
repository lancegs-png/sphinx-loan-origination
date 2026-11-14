"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveLoanField, setLoanFieldLock, syncLoanToSheet, pullFromSheet } from "@/app/actions";
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
  dscr_calc: "DSCR Calculation",
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
  // Property Information
  property_address: "Full Address",
  property_street: "Street Address",
  property_city: "City",
  property_state: "State",
  property_zip: "Zip Code",
  property_type: "Property Type",
  unit_count: "Unit Count",
  occupancy: "Occupancy",
  as_is_value: "As-Is Value",
  purchase_price: "Purchase Price",
  original_purchase_price: "Original Purchase Price",
  monthly_rent: "Monthly Rent",
  annual_taxes: "Annual Taxes",
  annual_insurance: "Annual Insurance",
  annual_hoa: "Annual HOA",
  payoff_amount: "Payoff",
  // DSCR Calculation
  principal_and_interest: "Monthly P+I Payment",
  monthly_taxes: "Monthly Taxes",
  monthly_insurance: "Monthly Insurance",
  monthly_hoa: "Monthly HOA",
  monthly_piti: "Monthly PITI",
  dscr: "DSCR",
  // Trade Information
  investor_name: "Investor Name",
  lock_date: "Lock Date",
  lock_expiration_date: "Lock Expiration",
  lock_price: "Lock Price",
  servicer_name: "Servicer",
  servicing_number: "Servicer ID",
  // Borrower Information
  borrower_entity: "Entity Name",
  entity_ein: "Entity EIN",
  guarantor_first_name: "Guarantor First Name",
  guarantor_last_name: "Guarantor Last Name",
  guarantor_phone: "Guarantor Phone",
  guarantor_email: "Guarantor Email",
  guarantor_fico: "Guarantor Credit",
  // Closing Calculations
  closing_date: "Closing Date",
  disbursement_date: "Disbursement Date",
  first_payment_date: "First Payment Date",
  reserve_amount: "PI Reserve",
  insurance_impound: "Insurance Impound",
  tax_impound: "Tax Impound",
  origination_fee_amount: "Origination Fee",
  underwriting_fee: "Underwriting Fee",
  legal_fee: "Legal Fee",
  prepaid_interest: "Prepaid Interest",
  net_wire: "Net Wire",
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
  "entity_type",
  "entity_state",
  "guarantor_first_name",
  "guarantor_last_name",
  "guarantor_fico",
  "guarantor_citizenship",
  "guarantor_ownership_pct",
  "legal_description",
  "insurance_coverage",
  "lease_start_date",
  "lease_end_date",
  "arv",
  "rehab_budget",
  "experience_property_count",
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
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const router = useRouter();

  // Auto-dismiss the save toast (errors linger a little longer so they can be read).
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), status.ok ? 2200 : 6000);
    return () => clearTimeout(t);
  }, [status]);

  // Inbound sync: pull any sheet edits into the app on open and on a light timer while a
  // lender is viewing. (app -> sheet is already instant; this is what lets sheet -> app work
  // with no per-loan Apps Script trigger.) Best-effort; refresh only when something changed.
  useEffect(() => {
    if (!canEdit || !isLender) return;
    let alive = true;
    let busy = false;
    const pull = async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await pullFromSheet(loan.id);
        if (alive && res.ok && (res.changed ?? 0) > 0) {
          const n = res.changed ?? 0;
          setStatus({ text: `Pulled ${n} update${n === 1 ? "" : "s"} from the sheet`, ok: true });
          router.refresh();
        }
      } catch {
        /* best-effort */
      } finally {
        busy = false;
      }
    };
    void pull();
    const t = setInterval(pull, 25000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [canEdit, isLender, loan.id, router]);

  // Collapsible section cards. All open by default except these three; the choice is
  // remembered per browser.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(["additional", "data_tape", "initial_property"]),
  );
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sphinx.loandata.collapsed");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);
  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem("sphinx.loandata.collapsed", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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
    setStatus(res.ok ? { text: `Saved ${def.label}`, ok: true } : { text: res.error ?? "Save failed", ok: false });
    // Pull in the recomputed AUTO values (DSCR, monthly P&I/PITI, etc.) after a save.
    if (res.ok) router.refresh();
  }

  async function toggleLock(def: FieldDef, locked: boolean) {
    const res = await setLoanFieldLock({ loanId: loan.id, key: def.key, locked });
    setStatus(
      res.ok
        ? { text: locked ? `Locked ${def.label}` : `Unlocked ${def.label}`, ok: true }
        : { text: res.error ?? "Failed", ok: false },
    );
  }

  function cardShell(key: string, title: string, children: ReactNode) {
    const isOpen = !collapsed.has(key);
    return (
      <section key={key} className="card overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-2 border-b border-[#bfdcf0] bg-[#e6f2fb] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[#15618f]"
        >
          <span>{title}</span>
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className={`h-3 w-3 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
          >
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* grid-rows 1fr↔0fr animates the height smoothly; the inner overflow-hidden clips
            the content as it collapses, and sibling cards slide up in the flex column. */}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="divide-y divide-line">{children}</div>
          </div>
        </div>
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

    // Closing Calculations reads as a ledger: dates on top, then Loan Amount (a repeat of
    // the loan field) and each deduction, with Net Wire as the total at the bottom.
    if (section === "closing") {
      const dates = inSection.filter((d) => d.type === "date");
      const amounts = inSection.filter((d) => d.type !== "date" && d.key !== "net_wire");
      const netWire = inSection.find((d) => d.key === "net_wire");
      const loanAmountDef = defs.find((d) => d.key === "loan_amount");
      return cardShell(
        section,
        SECTION_LABEL[section],
        <>
          {dates.map((d) => row(d))}
          {/* Separate the dates from the Net Wire ledger below. */}
          <div aria-hidden className="h-4 bg-surface-2" />
          {loanAmountDef && row(loanAmountDef)}
          {amounts.map((d) => row(d))}
          {netWire && (
            <div className="border-t-2 border-line-strong font-semibold">{row(netWire)}</div>
          )}
        </>,
      );
    }

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
    <div className="flex flex-col gap-6">
      {!canEdit && <p className="text-xs text-muted">Read-only</p>}
      {canEdit && <SheetSync loanId={loan.id} />}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {sectionCard("loan")}
          {sectionCard("property")}
          {sectionCard("dscr_calc")}
        </div>
        <div className="flex flex-col gap-6">
          {sectionCard("trade")}
          {sectionCard("borrower")}
          {sectionCard("contact")}
          {sectionCard("closing")}
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">{sectionCard("additional")}</div>
        <div className="flex flex-col gap-6">
          {sectionCard("data_tape")}
          {initialCard}
        </div>
      </div>
      {status && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md px-3 py-2 text-sm font-medium text-white shadow-lg"
          style={{ background: status.ok ? "#15618f" : "var(--status-outstanding)" }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}

/** One dense spreadsheet-style row: a label cell on the left, the value/editor on the right. */
// Fields that get a one-click copy button on the right of their value cell.
const COPYABLE_KEYS = new Set([
  "property_address",
  "title_contact_email",
  "insurance_contact_email",
  "guarantor_email",
  "guarantor_phone",
]);

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
  // The value to copy (only for copyable fields that actually have a value).
  const copy = COPYABLE_KEYS.has(def.key) && current ? current : undefined;

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
      <Row label={def.label} badge={calculated ? "auto" : undefined} copy={copy}>
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
        <Row label={def.label} locked={locked} onLock={() => onLock(!locked)} showLock={showLock} copy={copy}>
          <CellInput def={def} base={current} disabled={locked} onCommit={(v) => onSave("verified", v)} />
        </Row>
      );
    }
    return (
      <Row label={def.label} locked={locked} onLock={() => onLock(!locked)} showLock={showLock} copy={copy}>
        <div className="grid grid-cols-2 divide-x divide-line">
          <CellInput def={def} base={str(cell?.initial)} disabled={locked} placeholder="Initial" onCommit={(v) => onSave("initial", v)} />
          <CellInput def={def} base={str(cell?.verified)} disabled={locked} placeholder="Verified" onCommit={(v) => onSave("verified", v)} />
        </div>
      </Row>
    );
  }

  // Editable single value.
  return (
    <Row label={def.label} locked={locked} copy={copy}>
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
  copy,
}: {
  label: string;
  children: ReactNode;
  badge?: string;
  locked?: boolean;
  onLock?: () => void;
  showLock?: boolean;
  copy?: string;
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
      <div className="relative min-w-0">
        {/* Keep the value clear of the copy button so long emails/addresses don't run under it. */}
        <div className={copy ? "pr-8" : undefined}>{children}</div>
        {copy && <CopyButton value={copy} />}
      </div>
    </div>
  );
}

/** Small clipboard button pinned to the right of a value cell; shows a check briefly on copy. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function doCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={doCopy}
      title={copied ? "Copied" : "Copy"}
      aria-label={`Copy ${value}`}
      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: "var(--status-cleared, #16a34a)" }}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
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
  const focusedRef = useRef(false);

  // Keep the field current when its stored value changes elsewhere (a sheet→app sync, a
  // recompute, another user) — but never overwrite what someone is actively typing.
  useEffect(() => {
    if (!focusedRef.current) setValue(isCurrency ? fmtCurrency(base) : base);
    // fmtCurrency/isCurrency are derived from the (stable) field def.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

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
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
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

  // For a percent, size the input to its content so the "%" sits right after the number
  // instead of floating at the far right of the cell.
  const pctWidth = suffix ? `${Math.max((value || placeholder || "").length, 2) + 1}ch` : undefined;
  const input = (
    <input
      type={inputType}
      inputMode={def.type === "currency" || def.type === "percent" ? "decimal" : undefined}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      style={suffix ? { width: pctWidth } : undefined}
      className={`bg-transparent py-1.5 text-sm text-fg outline-none disabled:opacity-50 ${
        prefix ? "pl-1" : "pl-2"
      } ${suffix ? "pr-0" : "w-full pr-2"}`}
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
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
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
      {suffix && <span className="pl-0 pr-2 text-sm text-muted">{suffix}</span>}
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
