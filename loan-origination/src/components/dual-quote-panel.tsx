"use client";

import { useState } from "react";
import { dualQuote, postQuoteToChat, type DualQuote } from "@/app/actions";
import type { FieldValues, Loan } from "@/lib/types";
import type {
  InvestorQuote,
  PrepayTerm,
  PropertyKind,
  Purpose,
  QuoteParams,
  RateType,
} from "@/lib/pricing/general";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function purposeFrom(cf: Record<string, unknown>): Purpose {
  const s = String(cf.loan_purpose ?? cf.purchase_or_refinance ?? "").toLowerCase();
  if (s.includes("cash")) return "co";
  if (s.includes("refinance") || s.includes("r/t") || s.includes("rate")) return "rt";
  return "purchase";
}
function propertyFrom(loan: Loan, cf: Record<string, unknown>): PropertyKind {
  const s = String(cf.property_type ?? loan.loan_type ?? "").toLowerCase();
  if (s.includes("5-9") || s.includes("5 to 9")) return "5-9";
  if (s.includes("2-4") || s.includes("multi")) return "2-4";
  if (s.includes("non-warrant") || s.includes("nw")) return "nw_condo";
  if (s.includes("condo")) return "condo";
  if (s.includes("short") || s.includes("str")) return "str";
  return "sfr";
}

export function DualQuotePanel({ loan, values }: { loan: Loan; values: FieldValues }) {
  const cf: Record<string, unknown> = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v.current]),
  );
  const [f, setF] = useState({
    mode: "rate" as "rate" | "targetPrice",
    rate: "7.25",
    targetPrice: "100",
    rateType: "fixed30" as RateType,
    origPct: "1",
    prepay: "5yr" as PrepayTerm,
    lockDays: 30 as 30 | 45 | 60,
    loanAmount: String(loan.loan_amount ?? ""),
    propertyValue: String(num(cf.as_is_value) || num(cf.property_value) || ""),
    fico: String(num(cf.guarantor_fico) || num(cf.guarantor_credit) || ""),
    purpose: purposeFrom(cf),
    property: propertyFrom(loan, cf),
    monthlyRent: String(num(cf.monthly_rent) || ""),
    annualTaxes: String(num(cf.annual_taxes) || ""),
    annualInsurance: String(num(cf.annual_insurance) || ""),
    annualHOA: String(num(cf.annual_hoa) || ""),
    interestOnly: false,
    foreignNational: false,
    firstTimeInvestor: false,
  });
  const [res, setRes] = useState<DualQuote | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function calc() {
    setBusy(true);
    setMsg(null);
    const params: QuoteParams = {
      mode: f.mode,
      rate: f.mode === "rate" ? num(f.rate) / 100 : undefined,
      targetPrice: f.mode === "targetPrice" ? num(f.targetPrice) : undefined,
      rateType: f.rateType,
      prepay: f.prepay,
      lockDays: f.lockDays,
      loanAmount: num(f.loanAmount),
      propertyValue: num(f.propertyValue),
      fico: num(f.fico),
      purpose: f.purpose,
      property: f.property,
      monthlyRent: num(f.monthlyRent),
      annualTaxes: num(f.annualTaxes),
      annualInsurance: num(f.annualInsurance),
      annualHOA: num(f.annualHOA),
      termMonths: 360,
      interestOnly: f.interestOnly,
      foreignNational: f.foreignNational,
      firstTimeInvestor: f.firstTimeInvestor,
    };
    const r = await dualQuote(params);
    setBusy(false);
    if (r.ok && r.result) setRes(r.result);
    else {
      setRes(null);
      setMsg(r.error ?? "Could not price this loan.");
    }
  }

  async function post(best: InvestorQuote) {
    const loanAmt = num(f.loanAmount);
    const origDollars = Math.round((loanAmt * num(f.origPct)) / 100);
    const ratePct = (best.rate * 100).toFixed(3).replace(/\.?0+$/, "");
    const summary = [
      "Here is your quote based on your preliminary info:",
      "",
      `• Loan amount: $${loanAmt.toLocaleString()}`,
      `• Rate: ${ratePct}% · 30-year · ${f.prepay} prepay`,
      `• Origination fee: ${f.origPct}% ($${origDollars.toLocaleString()})`,
      `• LTV: ${best.ltv}%`,
      `• DSCR: ${best.dscr}`,
      `• Est. monthly payment (PITIA): $${best.pitia.toLocaleString()}`,
      "",
      "Final terms are subject to underwriting and approval.",
    ].join("\n");
    const terms = {
      loan_amount: loanAmt,
      rate: ratePct,
      prepay: f.prepay,
      origination_pct: f.origPct,
      origination_amount: origDollars,
      ltv: best.ltv,
      dscr: best.dscr,
      pitia: best.pitia,
    };
    setBusy(true);
    const r = await postQuoteToChat(loan.id, summary, terms);
    setBusy(false);
    setMsg(r.ok ? "Posted to chat." : r.error ?? "Could not post.");
  }

  const Num = (label: string, k: keyof typeof f) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} className="field field-sm w-full" />
    </label>
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1 text-xs">
        <button
          onClick={() => set("mode", "rate")}
          className={`flex-1 rounded-md px-2 py-1.5 ${f.mode === "rate" ? "bg-surface font-semibold text-fg shadow-sm" : "text-muted"}`}
        >
          Enter rate → price
        </button>
        <button
          onClick={() => set("mode", "targetPrice")}
          className={`flex-1 rounded-md px-2 py-1.5 ${f.mode === "targetPrice" ? "bg-surface font-semibold text-fg shadow-sm" : "text-muted"}`}
        >
          Target price → rate
        </button>
      </div>

      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Inputs</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {f.mode === "rate" ? Num("Rate (%)", "rate") : Num("Target price", "targetPrice")}
        {Num("Origination fee (%)", "origPct")}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Rate type</span>
          <select value={f.rateType} onChange={(e) => set("rateType", e.target.value as RateType)} className="field select field-sm w-full">
            <option value="fixed30">30-yr Fixed</option>
            <option value="arm_5_1">5/1 ARM</option>
            <option value="arm_7_1">7/1 ARM</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Prepay</span>
          <select value={f.prepay} onChange={(e) => set("prepay", e.target.value as PrepayTerm)} className="field select field-sm w-full">
            {["5yr", "4yr", "3yr", "2yr", "1yr", "none"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Lock (days)</span>
          <select value={f.lockDays} onChange={(e) => set("lockDays", Number(e.target.value) as 30 | 45 | 60)} className="field select field-sm w-full">
            {[30, 45, 60].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {Num("Loan amount", "loanAmount")}
        {Num("Property value", "propertyValue")}
        {Num("FICO", "fico")}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Purpose</span>
          <select value={f.purpose} onChange={(e) => set("purpose", e.target.value as Purpose)} className="field select field-sm w-full">
            <option value="purchase">Purchase</option>
            <option value="rt">Refi — Rate/Term</option>
            <option value="co">Refi — Cash-Out</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Property type</span>
          <select value={f.property} onChange={(e) => set("property", e.target.value as PropertyKind)} className="field select field-sm w-full">
            <option value="sfr">SFR / PUD / Townhome</option>
            <option value="2-4">2-4 Unit</option>
            <option value="5-9">5-9 Unit</option>
            <option value="condo">Condo</option>
            <option value="nw_condo">Non-warrantable Condo</option>
            <option value="str">Short-Term Rental</option>
          </select>
        </label>
        {Num("Monthly rent", "monthlyRent")}
        {Num("Annual taxes", "annualTaxes")}
        {Num("Annual insurance", "annualInsurance")}
        {Num("Annual HOA", "annualHOA")}
        <div className="col-span-2 mt-0.5 flex flex-wrap gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="accent-navy" checked={f.interestOnly} onChange={(e) => set("interestOnly", e.target.checked)} /> Interest only
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="accent-navy" checked={f.foreignNational} onChange={(e) => set("foreignNational", e.target.checked)} /> Foreign national
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="accent-navy" checked={f.firstTimeInvestor} onChange={(e) => set("firstTimeInvestor", e.target.checked)} /> First-time investor
          </label>
        </div>
      </div>

      <button onClick={calc} disabled={busy} className="btn btn-primary w-full">
        {busy ? "Pricing…" : "Price both investors"}
      </button>

      {res && (
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {res.quotes.map((q) => (
            <InvestorCard key={q.family} q={q} isBest={res.best === q.family} mode={f.mode} origPct={num(f.origPct)} loanAmount={num(f.loanAmount)} onPost={() => post(q)} busy={busy} />
          ))}
        </div>
      )}
      {res && res.quotes.every((q) => !q.eligible) && (
        <p className="text-xs text-muted">Neither investor is eligible as entered — see the notes under each.</p>
      )}
      {msg && <p className="text-muted">{msg}</p>}
      <p className="text-xs text-muted">
        Price &amp; points are internal — the posted summary shows only borrower-facing terms.
      </p>
    </div>
  );
}

function InvestorCard({
  q,
  isBest,
  mode,
  origPct,
  loanAmount,
  onPost,
  busy,
}: {
  q: InvestorQuote;
  isBest: boolean;
  mode: "rate" | "targetPrice";
  origPct: number;
  loanAmount: number;
  onPost: () => void;
  busy: boolean;
}) {
  return (
    <div className={`card flex flex-col gap-2 p-3.5 ${isBest ? "ring-2 ring-navy" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="font-semibold text-fg">{q.investor}</div>
        {isBest && <span className="status-pill status-approved">Best execution</span>}
      </div>
      {q.effectiveDate && <div className="-mt-1 text-xs text-muted">Sheet {q.effectiveDate}</div>}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Metric label={mode === "targetPrice" ? "Rate (solved)" : "Rate"} value={`${(q.rate * 100).toFixed(3)}%`} />
        <Metric label="Net price" value={q.netPrice != null ? q.netPrice.toFixed(3) : "—"} />
        <Metric label="LTV" value={`${q.ltv}%`} />
        <Metric label="DSCR" value={String(q.dscr)} />
        <Metric label="Max LTV" value={q.maxLtv != null ? `${q.maxLtv}%` : "—"} />
        <Metric label="Max loan" value={q.maxLoan != null ? `$${q.maxLoan.toLocaleString()}` : "—"} />
        <Metric label="PITIA" value={`$${q.pitia.toLocaleString()}`} />
        <Metric label="Points" value={q.points != null ? `${q.points >= 0 ? "+" : ""}${q.points}` : "—"} />
      </div>

      <div className="border-t border-line pt-1.5">
        <Row label="Base price" value={q.basePrice} />
        {q.adjustments.map((a, i) => <Row key={i} label={a.label} value={a.value} />)}
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
          <span>Net{q.cappedAt ? " (capped)" : q.flooredAt ? " (floored)" : ""}</span>
          <span>{q.netPrice ?? "—"}</span>
        </div>
      </div>

      <div className={`status-pill self-start ${q.eligible ? "status-approved" : "status-outstanding"}`}>
        {q.eligible ? "Eligible" : "Review required"}
      </div>
      {q.issues.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted">
          {q.issues.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
      <button onClick={onPost} disabled={busy} className="btn btn-secondary mt-1 self-start text-sm">
        Post {origPct ? `(${origPct}% orig, $${Math.round((loanAmount * origPct) / 100).toLocaleString()})` : ""} to chat
      </button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span>{value == null ? "N/A" : value}</span>
    </div>
  );
}
