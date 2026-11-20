// A lightweight, configurable rate/fee pricer for programs that don't have a parsed investor
// sizer (everything except DSCR today). The program's pricing "model" jsonb carries a handful
// of numeric knobs set in Settings; this turns them + the loan inputs into the same QuoteResult
// shape the DSCR engine produces, so the generic Quote panel renders it unchanged.

import type { QuoteInput, QuoteResult } from "./engine";

export type SimpleModel = {
  base_rate?: number; // %, default/reference rate for the program
  points?: number; // lender points charged
  origination_pct?: number; // %
  term_months?: number;
  max_ltv?: number; // %
  min_dscr?: number; // 0 / omitted = not enforced
  min_loan?: number;
  max_loan?: number;
};

const NUM_KEYS: (keyof SimpleModel)[] = [
  "base_rate",
  "points",
  "origination_pct",
  "term_months",
  "max_ltv",
  "min_dscr",
  "min_loan",
  "max_loan",
];

/** Extract the numeric grid knobs from a program_pricing.model jsonb, or null if none are set
 *  (so the caller can fall back to "no pricing configured"). Ignores non-grid keys like the
 *  DSCR program's `engine` / `engines`. */
export function simpleModelFrom(model: Record<string, unknown> | null | undefined): SimpleModel | null {
  if (!model) return null;
  const out: SimpleModel = {};
  let any = false;
  for (const k of NUM_KEYS) {
    const v = model[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) {
      out[k] = n;
      any = true;
    }
  }
  return any ? out : null;
}

function monthlyPI(principal: number, rate: number, n: number, io: boolean): number {
  const r = rate / 12;
  if (io) return principal * r;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function round(v: number, d = 3): number {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/**
 * Price a loan from a program's simple rate/fee grid. Uses the loan officer's entered rate for
 * the payment (falling back to the program's base_rate), and the program's configured limits
 * (max LTV, min DSCR, loan-size band) for eligibility. Price/points reflect the configured
 * lender points; there is no secondary-market grid, so net price is par.
 */
export function priceSimple(m: SimpleModel, input: QuoteInput): QuoteResult {
  const rate = input.rate > 0 ? input.rate : (m.base_rate ?? 0) / 100;
  const term = m.term_months && m.term_months > 0 ? m.term_months : input.termMonths || 360;
  const ltv = input.propertyValue > 0 ? (input.loanAmount / input.propertyValue) * 100 : 0;
  const pandi = monthlyPI(input.loanAmount, rate, term, input.interestOnly);
  const pitia = pandi + input.annualTaxes / 12 + input.annualInsurance / 12 + input.annualHOA / 12;
  const dscr = pitia > 0 ? input.monthlyRent / pitia : 0;

  const issues: string[] = [];
  if (m.max_ltv != null && ltv > m.max_ltv + 1e-9)
    issues.push(`LTV ${round(ltv, 2)}% exceeds the ${m.max_ltv}% max for this program.`);
  if (m.min_dscr != null && m.min_dscr > 0 && input.monthlyRent > 0 && dscr < m.min_dscr)
    issues.push(`DSCR ${round(dscr, 3)} is below the ${m.min_dscr} minimum.`);
  if (m.min_loan != null && input.loanAmount < m.min_loan)
    issues.push(`Loan amount is below the $${m.min_loan.toLocaleString()} minimum.`);
  if (m.max_loan != null && m.max_loan > 0 && input.loanAmount > m.max_loan)
    issues.push(`Loan amount exceeds the $${m.max_loan.toLocaleString()} maximum.`);

  return {
    ltv: round(ltv, 2),
    dscr: round(dscr, 3),
    pandi: round(pandi, 2),
    pitia: round(pitia, 2),
    basePrice: 100,
    adjustments: [],
    netPrice: 100,
    points: m.points ?? null,
    cappedAt: null,
    flooredAt: null,
    eligible: issues.length === 0,
    issues,
  };
}
