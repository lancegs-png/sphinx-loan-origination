"use client";

import { useState } from "react";
import { quoteLoan, postQuoteToChat } from "@/app/actions";
import type { Loan } from "@/lib/types";
import type {
  PrepayTerm,
  PropertyKind,
  Purpose,
  QuoteInput,
  QuoteResult,
} from "@/lib/pricing/engine";

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
  if (s.includes("2-4") || s.includes("multi")) return "2-4";
  if (s.includes("condo")) return "condo";
  return "sfr";
}

export function QuotePanel({
  loan,
  customFields,
}: {
  loan: Loan;
  customFields: Record<string, unknown>;
}) {
  const [f, setF] = useState({
    rate: "7.25",
    prepay: "5yr" as PrepayTerm,
    lockDays: 30 as 30 | 45 | 60,
    loanAmount: String(loan.loan_amount ?? ""),
    propertyValue: String(num(customFields.as_is_value) || num(customFields.property_value) || ""),
    fico: String(num(customFields.guarantor_credit) || ""),
    purpose: purposeFrom(customFields),
    property: propertyFrom(loan, customFields),
    monthlyRent: String(num(customFields.monthly_rent) || ""),
    annualTaxes: String(num(customFields.annual_taxes) || ""),
    annualInsurance: String(num(customFields.annual_insurance) || ""),
    annualHOA: String(num(customFields.annual_hoa) || ""),
    interestOnly: false,
    foreignNational: false,
    firstTimeInvestor: false,
  });
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function calc() {
    setBusy(true);
    setMsg(null);
    const input: QuoteInput = {
      rate: num(f.rate) / 100,
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
    const res = await quoteLoan(loan.id, input);
    setBusy(false);
    if (res.ok && res.result) setResult(res.result);
    else setMsg(res.error ?? "Could not price this loan.");
  }

  async function post() {
    if (!result) return;
    const summary = [
      `**Quote — ${loan.loan_number}**`,
      `• Loan amount: $${num(f.loanAmount).toLocaleString()}`,
      `• Rate: ${f.rate}% · 30-year · ${f.prepay} prepay`,
      `• Est. monthly (PITIA): $${result.pitia.toLocaleString()}`,
      `• LTV: ${result.ltv}% · DSCR: ${result.dscr}`,
      result.netPrice != null ? `• Price: ${result.netPrice} (${result.points! >= 0 ? "+" : ""}${result.points} pts)` : "",
      result.eligible ? "• Preliminary eligibility: passes" : "• Note: review required",
    ]
      .filter(Boolean)
      .join("\n");
    setBusy(true);
    const res = await postQuoteToChat(loan.id, summary);
    setBusy(false);
    setMsg(res.ok ? "Posted to chat." : res.error ?? "Could not post.");
  }

  const Num = (label: string, k: keyof typeof f) => (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <input
        value={String(f[k])}
        onChange={(e) => set(k, e.target.value as never)}
        className="rounded-md border border-line px-2 py-1.5"
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Inputs</h3>
      {Num("Rate (%)", "rate")}
      <label className="flex flex-col gap-1">
        <span className="text-muted">Prepay</span>
        <select value={f.prepay} onChange={(e) => set("prepay", e.target.value as PrepayTerm)} className="rounded-md border border-line px-2 py-1.5">
          {["5yr", "4yr", "3yr", "2yr", "1yr", "none"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Lock (days)</span>
        <select value={f.lockDays} onChange={(e) => set("lockDays", Number(e.target.value) as 30 | 45 | 60)} className="rounded-md border border-line px-2 py-1.5">
          {[30, 45, 60].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      {Num("Loan amount", "loanAmount")}
      {Num("Property value", "propertyValue")}
      {Num("FICO", "fico")}
      <label className="flex flex-col gap-1">
        <span className="text-muted">Purpose</span>
        <select value={f.purpose} onChange={(e) => set("purpose", e.target.value as Purpose)} className="rounded-md border border-line px-2 py-1.5">
          <option value="purchase">Purchase</option>
          <option value="rt">Refinance — Rate/Term</option>
          <option value="co">Refinance — Cash-Out</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Property type</span>
        <select value={f.property} onChange={(e) => set("property", e.target.value as PropertyKind)} className="rounded-md border border-line px-2 py-1.5">
          <option value="sfr">SFR / PUD / Townhome</option>
          <option value="2-4">2-4 Unit</option>
          <option value="condo">Condo</option>
          <option value="nw_condo">Non-warrantable Condo</option>
          <option value="str">Short-Term Rental</option>
        </select>
      </label>
      {Num("Monthly rent", "monthlyRent")}
      {Num("Annual taxes", "annualTaxes")}
      {Num("Annual insurance", "annualInsurance")}
      {Num("Annual HOA", "annualHOA")}
      <label className="flex items-center gap-2 text-muted">
        <input type="checkbox" checked={f.interestOnly} onChange={(e) => set("interestOnly", e.target.checked)} /> Interest only
      </label>
      <label className="flex items-center gap-2 text-muted">
        <input type="checkbox" checked={f.foreignNational} onChange={(e) => set("foreignNational", e.target.checked)} /> Foreign national
      </label>
      <label className="flex items-center gap-2 text-muted">
        <input type="checkbox" checked={f.firstTimeInvestor} onChange={(e) => set("firstTimeInvestor", e.target.checked)} /> First-time investor
      </label>

      <button onClick={calc} disabled={busy} className="rounded-md bg-fg px-4 py-2 font-medium text-white disabled:opacity-50">
        {busy ? "Pricing…" : "Calculate quote"}
      </button>

      {result && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Metric label="LTV" value={`${result.ltv}%`} />
            <Metric label="DSCR" value={String(result.dscr)} />
            <Metric label="P&I" value={`$${result.pandi.toLocaleString()}`} />
            <Metric label="PITIA" value={`$${result.pitia.toLocaleString()}`} />
          </div>
          <div className="border-t border-line pt-2">
            <Row label={`Base price (${f.rate}%)`} value={result.basePrice} />
            {result.adjustments.map((a, i) => (
              <Row key={i} label={a.label} value={a.value} />
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
              <span>Net price{result.cappedAt ? " (capped)" : result.flooredAt ? " (floored)" : ""}</span>
              <span>{result.netPrice ?? "—"}</span>
            </div>
            {result.points != null && (
              <div className="flex justify-between">
                <span className="text-muted">Points</span>
                <span>{result.points >= 0 ? "+" : ""}{result.points}</span>
              </div>
            )}
          </div>
          <div
            className="status-pill self-start"
            style={{ color: result.eligible ? "var(--status-approved)" : "var(--status-outstanding)" }}
          >
            {result.eligible ? "Eligible" : "Review required"}
          </div>
          {result.issues.length > 0 && (
            <ul className="list-disc pl-4 text-muted">
              {result.issues.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
          <button onClick={post} disabled={busy} className="mt-1 self-start rounded-md border border-line px-3 py-1.5 font-medium disabled:opacity-50">
            Post summary to chat
          </button>
        </div>
      )}
      {msg && <p className="text-muted">{msg}</p>}
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
