// Pure loan calculations, keyed to dictionary field keys (brief §4, dictionary Formula column).
// Each function takes a `get(key)` accessor over current field values and returns a map of
// calculated field keys -> values (null when inputs are missing). No IO here.

export type Get = (key: string) => unknown;

const num = (get: Get, key: string): number | null => {
  const v = get(key);
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Monthly fully-amortizing payment; interest-only when ioMonths > 0.
function monthlyPI(principal: number | null, ratePct: number | null, amortMonths: number, ioMonths: number): number | null {
  if (principal == null || ratePct == null) return null;
  const i = ratePct / 100 / 12;
  if (i === 0) return r2(principal / amortMonths);
  if (ioMonths > 0) return r2(principal * i); // interest-only during the IO period
  return r2((principal * i) / (1 - Math.pow(1 + i, -amortMonths)));
}

const parseYMD = (v: unknown): [number, number, number] | null => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const fmtYMD = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function addDays(ymd: unknown, days: number): string | null {
  const p = parseYMD(ymd);
  if (!p) return null;
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function commonCalcs(get: Get): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const street = get("property_street");
  const city = get("property_city");
  const state = get("property_state");
  const zip = get("property_zip");
  if (street || city || state || zip) {
    out.property_address = `${street ?? ""}, ${city ?? ""}, ${state ?? ""} ${zip ?? ""}`
      .replace(/\s+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/,\s*,/g, ",")
      .replace(/^,\s*|,\s*$/g, "")
      .trim();
  }

  const closing = parseYMD(get("closing_date"));
  if (closing) {
    // First payment = the 1st of the second month after closing (10/14 -> 12/1).
    let m = closing[1] - 1 + 2;
    const y = closing[0] + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    out.first_payment_date = fmtYMD(y, m + 1, 1);
  }

  // Amortization term mirrors the loan term (same value for DSCR); auto-populated so the
  // LOI and other templates don't require it to be entered separately.
  const loanTerm = num(get, "loan_term_months");
  if (loanTerm != null) out.amortization_term_months = loanTerm;

  const lockExp = addDays(get("lock_date"), 30);
  if (lockExp) out.lock_expiration_date = lockExp;

  const tsExp = addDays(get("term_sheet_date"), 7);
  if (tsExp) out.term_sheet_expiration_date = tsExp;

  return out;
}

export function dscrCalcs(get: Get): Record<string, unknown> {
  const annualTaxes = num(get, "annual_taxes");
  const annualIns = num(get, "annual_insurance");
  const annualHoa = num(get, "annual_hoa");
  // Raw (unrounded) monthly figures — used for downstream math so rounding doesn't
  // compound. The *_display values are what the app/dashboard show (rounded to cents).
  const monthly_taxes_raw = annualTaxes == null ? null : annualTaxes / 12;
  const monthly_insurance_raw = annualIns == null ? null : annualIns / 12;
  const monthly_hoa_raw = annualHoa == null ? null : annualHoa / 12;
  const monthly_taxes = monthly_taxes_raw == null ? null : r2(monthly_taxes_raw);
  const monthly_insurance = monthly_insurance_raw == null ? null : r2(monthly_insurance_raw);
  const monthly_hoa = monthly_hoa_raw == null ? null : r2(monthly_hoa_raw);

  const ltv = num(get, "ltv"); // entered input (percent)
  const asIs = num(get, "as_is_value");
  const rate = num(get, "interest_rate");
  // Amortization term = loan term (see commonCalcs); fall back to 360 if unset.
  const amortMonths = num(get, "loan_term_months") ?? 360;
  const ioMonths = num(get, "io_months") ?? 0;

  // loan_amount is derived from LTV: as_is_value x ltv%.
  const loanAmount = asIs != null && ltv != null ? r2((asIs * ltv) / 100) : null;
  const principal_and_interest = monthlyPI(loanAmount, rate, amortMonths, ioMonths);
  const piti =
    principal_and_interest == null
      ? null
      : r2(principal_and_interest + (monthly_taxes ?? 0) + (monthly_insurance ?? 0) + (monthly_hoa ?? 0));
  const rent = num(get, "monthly_rent");
  const dscr = rent != null && piti ? r3(rent / piti) : null;

  const origPct = num(get, "origination_fee_pct");
  const origination_fee_amount = loanAmount != null && origPct != null ? r2((loanAmount * origPct) / 100) : null;
  const reserveMonths = num(get, "reserve_months");
  // Closing ledger escrows (dashboard): PI Reserve = P&I x months; impounds = monthly
  // tax / insurance x months. Net Wire deducts each line below.
  const reserve_amount =
    principal_and_interest != null && reserveMonths != null ? r2(principal_and_interest * reserveMonths) : null;
  // Multiply the full-precision monthly figure (annual / 12), then round once — so the
  // cent-rounding on the displayed monthly value never compounds into the impound.
  const insurance_impound =
    monthly_insurance_raw != null && reserveMonths != null ? r2(monthly_insurance_raw * reserveMonths) : null;
  const tax_impound =
    monthly_taxes_raw != null && reserveMonths != null ? r2(monthly_taxes_raw * reserveMonths) : null;

  const payoff = num(get, "payoff_amount") ?? 0;
  const uw = num(get, "underwriting_fee") ?? 0;
  const legal = num(get, "legal_fee") ?? 0;
  const prepaid = num(get, "prepaid_interest") ?? 0; // manual input on the closing ledger
  const cash_out =
    loanAmount != null
      ? r2(loanAmount - payoff - (origination_fee_amount ?? 0) - uw - legal - (reserve_amount ?? 0))
      : null;
  const net_wire =
    loanAmount != null
      ? r2(
          loanAmount -
            (reserve_amount ?? 0) -
            (insurance_impound ?? 0) -
            (tax_impound ?? 0) -
            (origination_fee_amount ?? 0) -
            uw -
            legal -
            prepaid,
        )
      : null;

  return {
    loan_amount: loanAmount, // derived from LTV
    monthly_taxes,
    monthly_insurance,
    monthly_hoa,
    principal_and_interest,
    monthly_piti: piti,
    dscr,
    origination_fee_amount,
    reserve_amount,
    insurance_impound,
    tax_impound,
    cash_out,
    net_wire,
    cltv: ltv, // 1st lien only
  };
}

export function rtlCalcs(get: Get): Record<string, unknown> {
  const purchase = num(get, "purchase_price");
  const leverage = num(get, "initial_leverage_pct");
  const rehab = num(get, "rehab_budget");
  const budgetPct = num(get, "budget_financed_pct");
  const rate = num(get, "interest_rate");
  const arv = num(get, "arv");

  const initial_loan_amount = purchase != null && leverage != null ? r2((purchase * leverage) / 100) : null;
  const budget_financed_amount = rehab != null && budgetPct != null ? r2((rehab * budgetPct) / 100) : null;
  const total_loan_amount =
    initial_loan_amount != null && budget_financed_amount != null
      ? r2(initial_loan_amount + budget_financed_amount)
      : null;

  const ltc_initial = initial_loan_amount != null && purchase ? r2((initial_loan_amount / purchase) * 100) : null;
  const denom = (purchase ?? 0) + (rehab ?? 0);
  const ltc_total = total_loan_amount != null && denom ? r2((total_loan_amount / denom) * 100) : null;
  const arltv = total_loan_amount != null && arv ? r2((total_loan_amount / arv) * 100) : null;

  const initial_monthly_payment =
    initial_loan_amount != null && rate != null ? r2((initial_loan_amount * rate) / 1200) : null;
  const fully_disbursed_monthly_payment =
    total_loan_amount != null && rate != null ? r2((total_loan_amount * rate) / 1200) : null;

  const origPct = num(get, "origination_fee_pct");
  const origination_fee_amount =
    total_loan_amount != null && origPct != null ? r2((total_loan_amount * origPct) / 100) : null;
  const uw = num(get, "underwriting_fee") ?? 0;
  const legal = num(get, "legal_fee") ?? 0;
  const closing_costs = origination_fee_amount != null ? r2(origination_fee_amount + uw + legal) : null;

  const count = num(get, "experience_property_count");
  const borrower_experience_tier =
    count == null
      ? null
      : count <= 1
        ? "Tier 1 (0-1 properties)"
        : count <= 9
          ? "Tier 2 (2-9 properties)"
          : "Tier 3 (10+ properties)";

  return {
    initial_loan_amount,
    budget_financed_amount,
    total_loan_amount,
    loan_amount: total_loan_amount, // RTL: the loan amount is the total
    ltc_initial,
    ltc_total,
    arltv,
    cltv: arltv,
    initial_monthly_payment,
    fully_disbursed_monthly_payment,
    origination_fee_amount,
    closing_costs,
    borrower_experience_tier,
  };
}
