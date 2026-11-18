// Generalized DSCR pricing engine. One config shape (GeneralConfig) is produced by the
// per-investor sizer parsers (Eastview, Deephaven) and priced by priceQuote(). Prices are all
// 100-based points (par = 100); the Eastview parser scales its 1.0-based sheet values ×100.

export type InvestorFamily = "eastview" | "deephaven";
export type RateType = "fixed30" | "arm_5_1" | "arm_7_1";
export type PrepayTerm = "5yr" | "4yr" | "3yr" | "2yr" | "1yr" | "none";
export type Purpose = "purchase" | "rt" | "co";
export type PropertyKind = "sfr" | "2-4" | "condo" | "nw_condo" | "str" | "5-9";

/** label -> 7 adjustments aligned to LTV_UPPERS buckets. */
export type LtvGrid = Record<string, (number | null)[]>;

export type LevRow = {
  fico: string; // bucket label, e.g. "780+", "Foreign National"
  purpose: Purpose;
  max_asis_ltv: number | null; // decimal, e.g. 0.8
  max_ltc: number | null;
};

export type EligTier = {
  max_loan: number;
  min_dscr: number;
  fico: number;
  ltv_purch: number | null;
  ltv_rt: number | null;
  ltv_co: number | null;
};

export type GeneralConfig = {
  family: InvestorFamily;
  investor: string; // display name, e.g. "Eastview"
  effective_date: string | null;
  tier: string | null; // e.g. "Silver"
  source_file: string | null;
  base_curves: Partial<Record<RateType, [number, number][]>>; // [rate(decimal), price(100-based)]
  grids: {
    fico?: LtvGrid;
    dscr?: LtvGrid;
    upb?: LtvGrid;
    purpose?: LtvGrid;
    proptype?: LtvGrid;
    prepay?: LtvGrid;
    other?: LtvGrid; // feature rows keyed by label (e.g. Interest Only)
  };
  caps: Record<string, number | null>; // 100-based, family-specific keys
  min_price: number; // 100-based
  lock: { d45: number | null; d60: number | null };
  leverage?: { rows: LevRow[]; min_loan: number | null; max_loan: number | null }; // Eastview
  eligibility_tiers?: EligTier[]; // Deephaven
  min_loan: number;
  max_loan: number;
};

export type QuoteParams = {
  mode: "rate" | "targetPrice";
  rate?: number; // decimal, when mode="rate"
  targetPrice?: number; // 100-based, when mode="targetPrice"
  rateType: RateType;
  prepay: PrepayTerm;
  lockDays: 30 | 45 | 60;
  loanAmount: number;
  propertyValue: number;
  fico: number;
  purpose: Purpose;
  property: PropertyKind;
  monthlyRent: number;
  annualTaxes: number;
  annualInsurance: number;
  annualHOA: number;
  termMonths: number;
  interestOnly: boolean;
  foreignNational: boolean;
  firstTimeInvestor: boolean;
};

export type QuoteLine = { label: string; value: number | null };
export type InvestorQuote = {
  investor: string;
  family: InvestorFamily;
  effectiveDate: string | null;
  rate: number; // decimal — echoed, or solved when mode="targetPrice"
  ltv: number;
  dscr: number;
  pandi: number;
  pitia: number;
  basePrice: number | null; // 100-based
  adjustments: QuoteLine[];
  netPrice: number | null; // 100-based
  points: number | null; // netPrice - 100
  cappedAt: number | null;
  flooredAt: number | null;
  maxLtv: number | null; // %, from leverage/eligibility
  maxLoan: number | null; // $, min(program max, maxLtv × value)
  eligible: boolean;
  priceable: boolean;
  issues: string[];
};

export const LTV_UPPERS = [50, 55, 60, 65, 70, 75, 80];

export function ltvIndex(ltv: number): number | null {
  for (let i = 0; i < LTV_UPPERS.length; i++) if (ltv <= LTV_UPPERS[i] + 1e-9) return i;
  return null; // > 80 → off the grid
}

function round(v: number, d = 3): number {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function monthlyPI(principal: number, rate: number, n: number, io: boolean): number {
  const r = rate / 12;
  if (io) return principal * r;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function baseCurve(cfg: GeneralConfig, rateType: RateType): [number, number][] {
  const c = cfg.base_curves[rateType] ?? cfg.base_curves.fixed30 ?? [];
  return [...c].sort((a, b) => a[0] - b[0]);
}

/** Interpolate price (100-based) for a rate off the base curve. */
export function basePriceAt(curve: [number, number][], rate: number): number | null {
  if (curve.length === 0) return null;
  if (rate <= curve[0][0]) return curve[0][1];
  if (rate >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [r0, p0] = curve[i];
    const [r1, p1] = curve[i + 1];
    if (Math.abs(rate - r0) < 1e-9) return p0;
    if (rate > r0 && rate < r1) return round(p0 + ((rate - r0) / (r1 - r0)) * (p1 - p0), 4);
  }
  return curve[curve.length - 1][1];
}

/** Invert the base curve: smallest rate whose base price ≥ target (100-based). */
function rateForBase(curve: [number, number][], targetBase: number): number | null {
  if (curve.length === 0) return null;
  if (targetBase <= curve[0][1]) return curve[0][0];
  if (targetBase >= curve[curve.length - 1][1]) return curve[curve.length - 1][0];
  for (let i = 0; i < curve.length - 1; i++) {
    const [r0, p0] = curve[i];
    const [r1, p1] = curve[i + 1];
    if (targetBase >= p0 && targetBase <= p1 && p1 !== p0)
      return round(r0 + ((targetBase - p0) / (p1 - p0)) * (r1 - r0), 5);
  }
  return null;
}

function ficoEastview(fico: number, fn: boolean): string {
  if (fn) return "Foreign National";
  const b: [number, string][] = [
    [780, "780+"], [760, "760 - 779"], [740, "740 - 759"], [720, "720 - 739"],
    [700, "700 - 719"], [680, "680 - 699"], [660, "660 - 679"], [640, "640 - 659"], [620, "620 - 639"],
  ];
  for (const [lo, lab] of b) if (fico >= lo) return lab;
  return "620 - 639";
}
function ficoDeephaven(fico: number, fn: boolean): string {
  if (fn) return "FN";
  for (const lo of [780, 760, 740, 720, 700, 680, 660]) if (fico >= lo) return String(lo);
  return "660";
}

/** Find a grid row by fuzzy label match (first row whose label contains all needle fragments). */
function pick(grid: LtvGrid | undefined, ...needles: string[]): [string, (number | null)[]] | null {
  if (!grid) return null;
  const keys = Object.keys(grid);
  for (const k of keys) {
    const lk = k.toLowerCase();
    if (needles.every((n) => lk.includes(n.toLowerCase()))) return [k, grid[k]];
  }
  return null;
}

type Adj = { label: string; value: number | null; na: boolean };

function selectAdjustments(cfg: GeneralConfig, p: QuoteParams, li: number, dscr: number): Adj[] {
  const adj: Adj[] = [];
  const g = cfg.grids;
  const push = (label: string, row: [string, (number | null)[]] | null) => {
    if (!row) return;
    const v = row[1][li];
    adj.push({ label: `${label}`, value: v, na: v == null });
  };

  if (cfg.family === "eastview") {
    push("FICO × LTV", pick(g.fico, ficoEastview(p.fico, p.foreignNational)));
    const dLab = dscr >= 1.25 ? ">=1.25" : dscr >= 1.0 ? ">=1.00x" : ">=0.75x";
    push("DSCR", pick(g.dscr, dLab));
    if (p.loanAmount <= 150000) push("Loan amount", pick(g.upb, "150"));
    else if (p.loanAmount >= 2000000) push("Loan amount", pick(g.upb, "2,000,000"));
    if (p.purpose === "purchase") push("Purchase", pick(g.purpose, "purchase"));
    else if (p.purpose === "co") push("Cash-out", pick(g.purpose, "cash out"));
    const propRow =
      p.property === "condo" ? pick(g.proptype, "condo") :
      p.property === "nw_condo" ? pick(g.proptype, "non-warrantable") :
      p.property === "2-4" ? pick(g.proptype, "2-4") :
      p.property === "5-9" ? pick(g.proptype, "5-9") : null;
    if (propRow) push("Property type", propRow);
    const ppLab: Record<PrepayTerm, string[]> = {
      "5yr": ["5 years (5%"], "4yr": ["3 years"], "3yr": ["3 years"],
      "2yr": ["2 years"], "1yr": ["1 year"], none: ["no prepayment"],
    };
    push("Prepay", pick(g.prepay, ...ppLab[p.prepay]));
    if (p.interestOnly) push("Interest only", pick(g.other, "interest only"));
  } else {
    // deephaven
    push("FICO × LTV", pick(g.fico, ficoDeephaven(p.fico, p.foreignNational)));
    const o = g.other;
    if (p.purpose === "purchase") push("Purchase", pick(o, "purchase"));
    else if (p.purpose === "co") push("Cash-out", pick(o, "cash-out", p.fico >= 720 ? "≥ 720" : "< 720"));
    const ppLab: Record<PrepayTerm, string> = {
      "5yr": "5 yr prepay", "4yr": "4 yr prepay", "3yr": "3 yr prepay",
      "2yr": "2 yr prepay", "1yr": "1 yr prepay", none: "no prepay",
    };
    push("Prepay", pick(o, ppLab[p.prepay]));
    if (dscr < 1.0) push("DSCR < 1.00x", pick(o, "dscr < 1.00"));
    else if (dscr >= 1.25) push("DSCR ≥ 1.25x", pick(o, "dscr ≥ 1.25"));
    else if (dscr >= 1.15) push("DSCR 1.15–1.24", pick(o, "dscr 1.15"));
    const propRow =
      p.property === "condo" ? pick(o, "condo") :
      p.property === "nw_condo" ? pick(o, "nw condo") :
      p.property === "2-4" ? pick(o, "2-4 unit") :
      p.property === "str" ? pick(o, "short term rental") : null;
    if (propRow) push("Property type", propRow);
    // Loan-amount bands
    if (p.loanAmount < 150000) push("Loan amount", pick(o, "<$150k"));
    else if (p.loanAmount < 250000) push("Loan amount", pick(o, "<$250k"));
    else if (p.loanAmount > 1000000) push("Loan amount", pick(o, "> $1.0m"));
    else if (p.loanAmount >= 750000) push("Loan amount", pick(o, "≥ $750k"));
    else if (p.loanAmount >= 400000) push("Loan amount", pick(o, "≥$400k"));
    if (p.interestOnly) push("Interest only", pick(o, "i/o"));
  }
  return adj;
}

function capFor(cfg: GeneralConfig, p: QuoteParams): number | null {
  const c = cfg.caps;
  const cands: (number | null | undefined)[] = [];
  if (cfg.family === "deephaven") {
    const ppKey: Record<PrepayTerm, string> = {
      "5yr": "Max Price (5Yr PPP)", "4yr": "Max Price (3Yr & 4Yr PPP)", "3yr": "Max Price (3Yr & 4Yr PPP)",
      "2yr": "Max Price (2Yr PPP)", "1yr": "Max Price (1Yr PPP)", none: "Max Price (No Prepay)",
    };
    cands.push(c[ppKey[p.prepay]]);
    if (p.loanAmount < 150000) cands.push(c["<$150,000"]);
    else if (p.loanAmount <= 1500000) cands.push(c["≤ $1,500,000"]);
    else if (p.loanAmount <= 2000000) cands.push(c["≤ $2,000,000"]);
    else if (p.loanAmount <= 2500000) cands.push(c["≤ $2,500,000"]);
  } else {
    // eastview: max price by prepay (Prepayment Premiums block)
    const ppKey: Record<PrepayTerm, string> = {
      "5yr": "5", "4yr": "4", "3yr": "3", "2yr": "2", "1yr": "1", none: "no",
    };
    const k = Object.keys(c).find((x) => x.toLowerCase().includes(ppKey[p.prepay]));
    if (k) cands.push(c[k]);
  }
  const nums = cands.filter((x): x is number => typeof x === "number");
  return nums.length ? Math.min(...nums) : null;
}

function leverageFor(cfg: GeneralConfig, p: QuoteParams): { maxLtv: number | null; minDscr: number | null } {
  if (cfg.family === "eastview" && cfg.leverage) {
    const fico = ficoEastview(p.fico, p.foreignNational);
    const row = cfg.leverage.rows.find((r) => r.fico === fico && r.purpose === p.purpose);
    return { maxLtv: row?.max_asis_ltv != null ? row.max_asis_ltv * 100 : null, minDscr: null };
  }
  if (cfg.family === "deephaven" && cfg.eligibility_tiers?.length) {
    const groups = [...new Set(cfg.eligibility_tiers.map((t) => t.max_loan))].sort((a, b) => a - b);
    const group = groups.find((gp) => p.loanAmount <= gp) ?? groups[groups.length - 1];
    const tiers = cfg.eligibility_tiers.filter((t) => t.max_loan === group).sort((a, b) => b.fico - a.fico);
    const tier = tiers.find((t) => p.fico >= t.fico);
    if (!tier) return { maxLtv: null, minDscr: null };
    const ltv = p.purpose === "purchase" ? tier.ltv_purch : p.purpose === "rt" ? tier.ltv_rt : tier.ltv_co;
    return { maxLtv: ltv != null ? ltv * 100 : null, minDscr: tier.min_dscr };
  }
  return { maxLtv: null, minDscr: null };
}

export function priceQuote(cfg: GeneralConfig, p: QuoteParams): InvestorQuote {
  const issues: string[] = [];
  const ltv = p.propertyValue > 0 ? (p.loanAmount / p.propertyValue) * 100 : 0;
  const li = ltvIndex(ltv);
  const curve = baseCurve(cfg, p.rateType);

  // DSCR depends on the note rate (via P&I), and the DSCR adjustment depends on DSCR — so in
  // rate mode we compute DSCR from the given rate; in target-price mode we fixed-point iterate
  // (guess rate → DSCR → adjustments → solve rate), which converges in 1–2 passes because the
  // DSCR bands are coarse.
  const lock = p.lockDays === 45 ? cfg.lock.d45 : p.lockDays === 60 ? cfg.lock.d60 : 0;
  const dscrAt = (r: number): number => {
    const pi = monthlyPI(p.loanAmount, r, p.termMonths, p.interestOnly);
    const piti = pi + p.annualTaxes / 12 + p.annualInsurance / 12 + p.annualHOA / 12;
    return piti > 0 ? p.monthlyRent / piti : 0;
  };

  let rate = p.rate ?? curve[Math.floor(curve.length / 2)]?.[0] ?? 0.08;
  let adjSrc: Adj[] = [];
  let sumAdj = 0;
  const computeAdj = (r: number) => {
    const d = dscrAt(r);
    adjSrc = li == null ? [] : selectAdjustments(cfg, p, li, d);
    sumAdj = adjSrc.reduce((s, a) => s + (a.value ?? 0), 0) + (lock ?? 0);
  };

  if (p.mode === "targetPrice" && p.targetPrice != null) {
    for (let iter = 0; iter < 3; iter++) {
      computeAdj(rate);
      const solved = rateForBase(curve, p.targetPrice - sumAdj);
      if (solved == null) {
        issues.push("Target price is outside this investor's rate range.");
        break;
      }
      if (Math.abs(solved - rate) < 1e-6) {
        rate = solved;
        break;
      }
      rate = solved;
    }
  }
  computeAdj(rate);

  const pandi = monthlyPI(p.loanAmount, rate, p.termMonths, p.interestOnly);
  const pitia = pandi + p.annualTaxes / 12 + p.annualInsurance / 12 + p.annualHOA / 12;
  const dscr = pitia > 0 ? p.monthlyRent / pitia : 0;

  const basePrice = basePriceAt(curve, rate);
  const adjustments: QuoteLine[] = adjSrc.map((a) => ({ label: a.label, value: a.value }));
  if (lock) adjustments.push({ label: `${p.lockDays}-day lock`, value: lock });

  let priceable = basePrice != null;
  if (li == null) {
    issues.push(`LTV ${round(ltv, 2)}% is above the 80% pricing grid.`);
    priceable = false;
  }
  for (const a of adjSrc) if (a.na) {
    issues.push(`${a.label} is N/A at this LTV for ${cfg.investor}.`);
    priceable = false;
  }

  let netPrice: number | null = null;
  let points: number | null = null;
  let cappedAt: number | null = null;
  let flooredAt: number | null = null;
  if (priceable && basePrice != null) {
    let price = basePrice + sumAdj;
    const cap = capFor(cfg, p);
    if (cap != null && price > cap) { price = cap; cappedAt = cap; }
    if (price < cfg.min_price) { price = cfg.min_price; flooredAt = cfg.min_price; }
    netPrice = round(price, 3);
    points = round(netPrice - 100, 3);
  }

  // Leverage / eligibility
  const { maxLtv, minDscr } = leverageFor(cfg, p);
  if (maxLtv != null && ltv > maxLtv + 1e-9)
    issues.push(`LTV ${round(ltv, 2)}% exceeds ${cfg.investor}'s ${round(maxLtv, 1)}% max.`);
  if (minDscr != null && dscr < minDscr)
    issues.push(`DSCR ${round(dscr, 3)} is below ${cfg.investor}'s ${minDscr} minimum.`);
  if (p.loanAmount < cfg.min_loan)
    issues.push(`Loan $${p.loanAmount.toLocaleString()} is below the $${cfg.min_loan.toLocaleString()} minimum.`);
  if (cfg.max_loan && p.loanAmount > cfg.max_loan)
    issues.push(`Loan $${p.loanAmount.toLocaleString()} exceeds the $${cfg.max_loan.toLocaleString()} maximum.`);

  const maxLoan =
    maxLtv != null && p.propertyValue > 0
      ? Math.min(cfg.max_loan || Infinity, Math.round((maxLtv / 100) * p.propertyValue))
      : null;

  return {
    investor: cfg.investor,
    family: cfg.family,
    effectiveDate: cfg.effective_date,
    rate: round(rate, 5),
    ltv: round(ltv, 2),
    dscr: round(dscr, 3),
    pandi: round(pandi, 2),
    pitia: round(pitia, 2),
    basePrice,
    adjustments,
    netPrice,
    points,
    cappedAt,
    flooredAt,
    maxLtv: maxLtv != null ? round(maxLtv, 2) : null,
    maxLoan: maxLoan != null && Number.isFinite(maxLoan) ? maxLoan : null,
    eligible: priceable && issues.length === 0,
    priceable,
    issues,
  };
}
