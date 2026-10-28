// Deterministic DSCR/Investor-NQM pricing engine (M4).
// Consumes the parsed rate-sheet config stored on the program and computes a quote
// from the loan officer's entered rate plus the loan's attributes.

export type PricingConfig = {
  base_rates: [number, number][]; // [rate(decimal), price]
  caps: Record<string, number | null>; // 5yr|4yr|3yr|2yr|1yr|none|min|lock45|lock60
  fico_ltv: Record<string, Record<string, number | null>>; // '780'..'660','FN' -> ltv -> adj
  other: Record<string, Record<string, number | null>>; // category -> ltv -> adj
  eligibility_tiers: {
    max_loan: number;
    min_dscr: number;
    fico: number;
    ltv_purch: number | null;
    ltv_rt: number | null;
    ltv_co: number | null;
  }[];
  min_loan: number;
  overlays: {
    foreign_national_max_ltv: number;
    first_time_investor_max_ltv: number;
    io_min_dscr: number;
    dscr_below_1_ltv_reduction: number;
    dscr_floor: number;
  };
};

export type PrepayTerm = "5yr" | "4yr" | "3yr" | "2yr" | "1yr" | "none";
export type Purpose = "purchase" | "rt" | "co";
export type PropertyKind = "sfr" | "2-4" | "condo" | "nw_condo" | "str";

export type QuoteInput = {
  rate: number; // decimal, e.g. 0.0725
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
  termMonths: number; // 360
  interestOnly: boolean;
  foreignNational: boolean;
  firstTimeInvestor: boolean;
};

export type QuoteLine = { label: string; value: number | null };
export type QuoteResult = {
  ltv: number;
  dscr: number;
  pandi: number;
  pitia: number;
  basePrice: number | null;
  adjustments: QuoteLine[];
  netPrice: number | null;
  points: number | null; // netPrice - 100 (premium positive)
  cappedAt: number | null;
  flooredAt: number | null;
  eligible: boolean;
  issues: string[];
};

const LTV_COLS = [50, 55, 60, 65, 70, 75, 80];
const FICO_ROWS = [780, 760, 740, 720, 700, 680, 660];

function ltvCol(ltv: number): string | null {
  for (const c of LTV_COLS) if (ltv <= c + 1e-9) return String(c);
  return null; // > 80 → off the grid
}
function ficoRow(fico: number): string | null {
  for (const r of FICO_ROWS) if (fico >= r) return String(r);
  return null; // < 660
}

function basePriceFor(cfg: PricingConfig, rate: number): number | null {
  const rows = [...cfg.base_rates].sort((a, b) => a[0] - b[0]);
  if (rows.length === 0) return null;
  if (rate <= rows[0][0]) return rows[0][1];
  if (rate >= rows[rows.length - 1][0]) return rows[rows.length - 1][1];
  for (let i = 0; i < rows.length - 1; i++) {
    const [r0, p0] = rows[i];
    const [r1, p1] = rows[i + 1];
    if (Math.abs(rate - r0) < 1e-9) return p0;
    if (rate > r0 && rate < r1) {
      const t = (rate - r0) / (r1 - r0);
      return round(p0 + t * (p1 - p0), 4);
    }
  }
  return rows[rows.length - 1][1];
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

export function priceLoan(cfg: PricingConfig, inp: QuoteInput): QuoteResult {
  const issues: string[] = [];
  const ltv = inp.propertyValue > 0 ? (inp.loanAmount / inp.propertyValue) * 100 : 0;
  const pandi = monthlyPI(inp.loanAmount, inp.rate, inp.termMonths, inp.interestOnly);
  const pitia = pandi + inp.annualTaxes / 12 + inp.annualInsurance / 12 + inp.annualHOA / 12;
  const dscr = pitia > 0 ? inp.monthlyRent / pitia : 0;

  const col = ltvCol(ltv);
  const basePrice = basePriceFor(cfg, inp.rate);
  const adjustments: QuoteLine[] = [];
  let priceable = true;

  if (!col) {
    issues.push(`LTV ${round(ltv, 2)}% exceeds the 80% pricing grid.`);
    priceable = false;
  }

  function addAdj(label: string, grid: Record<string, number | null> | undefined) {
    if (!col || !grid) return;
    const v = grid[col];
    adjustments.push({ label, value: v });
    if (v == null) {
      issues.push(`${label} is not available at ${col}% LTV (N/A).`);
      priceable = false;
    }
  }

  // FICO x LTV (or Foreign National row)
  const fRow = inp.foreignNational ? "FN" : ficoRow(inp.fico);
  if (!fRow) {
    issues.push(`FICO ${inp.fico} is below the 660 minimum.`);
    priceable = false;
  } else {
    addAdj(`FICO×LTV (${fRow})`, cfg.fico_ltv[fRow]);
  }

  // Purpose
  if (inp.purpose === "purchase") addAdj("Purchase", cfg.other["Purchase"]);
  else if (inp.purpose === "co")
    addAdj(
      inp.fico >= 720 ? "Cash-Out (FICO ≥ 720)" : "Cash-Out (FICO < 720)",
      inp.fico >= 720 ? cfg.other["Cash-Out | FICO ≥ 720"] : cfg.other["Cash-Out | FICO < 720"],
    );

  // Property type
  const propKey: Record<PropertyKind, string | null> = {
    sfr: null,
    "2-4": "2-4 Unit",
    condo: "Condo",
    nw_condo: "NW Condo",
    str: "Short Term Rental",
  };
  if (propKey[inp.property]) addAdj(propKey[inp.property]!, cfg.other[propKey[inp.property]!]);

  // Loan amount bands
  if (inp.loanAmount < 150000) addAdj("Loan Amt < $150K", cfg.other["Loan Amt <$150K"]);
  else if (inp.loanAmount < 250000) addAdj("Loan Amt < $250K", cfg.other["Loan Amt <$250K"]);
  else if (inp.loanAmount > 2000000) addAdj("Loan Amt > $2.0M", cfg.other["Loan Amt > $2.0M"]);
  else if (inp.loanAmount > 1500000) addAdj("Loan Amt > $1.5M", cfg.other["Loan Amt > $1.5M"]);

  // Prepay term
  const prepayKey: Record<PrepayTerm, string> = {
    "5yr": "5 Yr Prepay",
    "4yr": "4 Yr Prepay",
    "3yr": "3 Yr Prepay",
    "2yr": "2 Yr Prepay",
    "1yr": "1 Yr Prepay",
    none: "No Prepay",
  };
  addAdj(`Prepay (${inp.prepay})`, cfg.other[prepayKey[inp.prepay]]);

  // DSCR band
  if (dscr < 1.0) addAdj("DSCR < 1.00x", cfg.other["DSCR < 1.00x"]);
  else if (dscr >= 1.15 && dscr <= 1.24) addAdj("DSCR 1.15–1.24", cfg.other["DSCR 1.15 - 1.24"]);
  else if (dscr >= 1.25) addAdj("DSCR ≥ 1.25x", cfg.other["DSCR ≥ 1.25x"]);

  // Interest only
  if (inp.interestOnly) addAdj("Interest Only", cfg.other["I/O"]);

  // Lock adjustment
  const lockAdj = inp.lockDays === 45 ? cfg.caps.lock45 : inp.lockDays === 60 ? cfg.caps.lock60 : 0;
  if (lockAdj) adjustments.push({ label: `${inp.lockDays}-day lock`, value: lockAdj });

  let netPrice: number | null = null;
  let cappedAt: number | null = null;
  let flooredAt: number | null = null;
  let points: number | null = null;
  if (priceable && basePrice != null) {
    let p = basePrice + adjustments.reduce((s, a) => s + (a.value ?? 0), 0);
    const cap = cfg.caps[inp.prepay];
    const floor = cfg.caps.min;
    if (cap != null && p > cap) {
      p = cap;
      cappedAt = cap;
    }
    if (floor != null && p < floor) {
      p = floor;
      flooredAt = floor;
    }
    netPrice = round(p, 3);
    points = round(netPrice - 100, 3);
  }

  // ---- Eligibility ----
  const elig = checkEligibility(cfg, inp, ltv, dscr);
  issues.push(...elig.reasons);

  return {
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
    eligible: priceable && elig.ok,
    issues,
  };
}

function checkEligibility(
  cfg: PricingConfig,
  inp: QuoteInput,
  ltv: number,
  dscr: number,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // Loan-size group
  const groups = [...new Set(cfg.eligibility_tiers.map((t) => t.max_loan))].sort((a, b) => a - b);
  const group = groups.find((g) => inp.loanAmount <= g);
  if (!group) {
    reasons.push(`Loan amount $${inp.loanAmount.toLocaleString()} exceeds the maximum.`);
    return { ok: false, reasons };
  }
  if (inp.loanAmount < cfg.min_loan)
    reasons.push(`Loan amount is below the $${cfg.min_loan.toLocaleString()} minimum.`);

  const tiersInGroup = cfg.eligibility_tiers
    .filter((t) => t.max_loan === group)
    .sort((a, b) => b.fico - a.fico);
  const tier = tiersInGroup.find((t) => inp.fico >= t.fico);
  if (!tier) {
    reasons.push(`FICO ${inp.fico} is below the minimum for this loan size.`);
    return { ok: false, reasons };
  }

  let maxLtv =
    (inp.purpose === "purchase" ? tier.ltv_purch : inp.purpose === "rt" ? tier.ltv_rt : tier.ltv_co) ??
    0;
  maxLtv *= 100;
  let minDscr = tier.min_dscr;

  // Overlays
  if (inp.foreignNational) maxLtv = Math.min(maxLtv, cfg.overlays.foreign_national_max_ltv);
  if (inp.firstTimeInvestor) maxLtv = Math.min(maxLtv, cfg.overlays.first_time_investor_max_ltv);
  if (inp.interestOnly) minDscr = Math.max(minDscr, cfg.overlays.io_min_dscr);
  if (dscr < 1.0) maxLtv -= cfg.overlays.dscr_below_1_ltv_reduction;

  if (dscr < cfg.overlays.dscr_floor)
    reasons.push(`DSCR ${round(dscr, 3)} is below the ${cfg.overlays.dscr_floor} floor.`);
  if (dscr < minDscr)
    reasons.push(`DSCR ${round(dscr, 3)} is below the ${minDscr} minimum for this tier.`);
  if (ltv > maxLtv + 1e-9)
    reasons.push(`LTV ${round(ltv, 2)}% exceeds the ${round(maxLtv, 1)}% max for this tier.`);

  return { ok: reasons.length === 0, reasons };
}
