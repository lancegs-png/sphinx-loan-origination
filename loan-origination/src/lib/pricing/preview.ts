import type { GeneralConfig } from "./general";

export type PricingPreview = {
  investor: string;
  family: string;
  effectiveDate: string | null;
  tier: string | null;
  sourceFile: string | null;
  rateRange: { low: number; high: number } | null; // decimal rates on the fixed-30 curve
  priceRange: { low: number; high: number } | null; // 100-based
  minPrice: number;
  minLoan: number;
  maxLoan: number;
  gridRows: Record<string, number>; // grid name -> row count
  leverageRows: number;
  eligibilityTiers: number;
  warnings: string[];
};

/** A compact, human-checkable summary of a parsed sizer — shown before publishing. */
export function buildPreview(cfg: GeneralConfig): PricingPreview {
  const curve = cfg.base_curves.fixed30 ?? [];
  const rates = curve.map((r) => r[0]);
  const prices = curve.map((r) => r[1]);
  const warnings: string[] = [];

  if (curve.length < 5) warnings.push("Base rate curve has very few rows — check the Pricing tab mapping.");
  const gridRows: Record<string, number> = {};
  for (const [name, grid] of Object.entries(cfg.grids)) {
    if (grid) gridRows[name] = Object.keys(grid).length;
  }
  if (!gridRows.fico) warnings.push("No FICO × LTV grid parsed.");
  if (cfg.family === "eastview" && !(cfg.leverage?.rows.length)) warnings.push("No leverage grid parsed.");
  if (cfg.family === "deephaven" && !(cfg.eligibility_tiers?.length)) warnings.push("No eligibility tiers parsed.");
  if (!cfg.effective_date) warnings.push("Effective date not found — publishing with no date.");

  return {
    investor: cfg.investor,
    family: cfg.family,
    effectiveDate: cfg.effective_date,
    tier: cfg.tier,
    sourceFile: cfg.source_file,
    rateRange: rates.length ? { low: Math.min(...rates), high: Math.max(...rates) } : null,
    priceRange: prices.length ? { low: Math.min(...prices), high: Math.max(...prices) } : null,
    minPrice: cfg.min_price,
    minLoan: cfg.min_loan,
    maxLoan: cfg.max_loan,
    gridRows,
    leverageRows: cfg.leverage?.rows.length ?? 0,
    eligibilityTiers: cfg.eligibility_tiers?.length ?? 0,
    warnings,
  };
}
