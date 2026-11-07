// Data tape export (brief §9, Data Tape Map tab). One row per property, exact column
// headers and order. Blank fields export blank — never 0, 1/0/1900, or an error.

export type TapeCtx = {
  cur: (key: string, idx?: number) => unknown; // current field value
  loanNumber: string;
  seller: string; // company config
};

type Col = { header: string; get: (c: TapeCtx, propIdx: number) => unknown };

const name = (c: TapeCtx, guarantorIdx: number) =>
  [c.cur("guarantor_first_name", guarantorIdx), c.cur("guarantor_last_name", guarantorIdx)]
    .filter(Boolean)
    .join(" ");

// Columns in the exact Data Tape Map order.
export const DATA_TAPE_COLUMNS: Col[] = [
  { header: "Loan Numbers", get: (c) => c.loanNumber },
  { header: "Seller", get: (c) => c.seller },
  { header: "Channel", get: (c) => c.cur("channel") },
  { header: "Seller Program", get: (c) => c.cur("seller_program") },
  { header: "Lien Position", get: (c) => c.cur("lien_position") },
  { header: "Total Loan Amount", get: (c) => c.cur("loan_amount") },
  { header: "Current UPB", get: (c) => c.cur("current_upb") },
  { header: "Borrower Name First", get: (c) => c.cur("guarantor_first_name", 1) },
  { header: "Borrower Name Last", get: (c) => c.cur("guarantor_last_name", 1) },
  { header: "Co-Borrower Name First", get: (c) => c.cur("guarantor_first_name", 2) },
  { header: "Co-Borrower Name Last", get: (c) => c.cur("guarantor_last_name", 2) },
  { header: "Borrowing Entity", get: (c) => c.cur("borrower_entity") },
  { header: "Guarantor", get: (c) => name(c, 1) },
  { header: "Guarantor 2", get: (c) => name(c, 2) },
  { header: "Property Address", get: (c, p) => c.cur("property_street", p) },
  { header: "Property City", get: (c, p) => c.cur("property_city", p) },
  { header: "Property State", get: (c, p) => c.cur("property_state", p) },
  { header: "Property Zip", get: (c, p) => c.cur("property_zip", p) },
  { header: "Note Rate", get: (c) => c.cur("interest_rate") },
  { header: "Pass-thru Rate", get: (c) => c.cur("pass_thru_rate") },
  { header: "FICO", get: (c) => c.cur("guarantor_fico", 1) },
  { header: "LTV / LTC", get: (c) => c.cur("ltv") },
  { header: "CLTV / LTARV", get: (c) => c.cur("cltv") },
  { header: "DSCR", get: (c) => c.cur("dscr") },
  { header: "DTI", get: (c) => c.cur("dti") },
  { header: "Sales Price", get: (c) => c.cur("purchase_price") },
  { header: "Property Value", get: (c, p) => c.cur("as_is_value", p) },
  { header: "Doc Type", get: (c) => c.cur("doc_type") },
  { header: "Doc Type Detail", get: (c) => c.cur("doc_type_detail") },
  { header: "Purpose", get: (c) => c.cur("loan_purpose") },
  { header: "Occupancy", get: (c, p) => c.cur("occupancy", p) },
  { header: "Property Type", get: (c, p) => c.cur("property_type", p) },
  { header: "Units", get: (c, p) => c.cur("unit_count", p) },
  { header: "Orig Term", get: (c) => c.cur("loan_term_months") },
  { header: "Amort Term", get: (c) => c.cur("amortization_term_months") },
  { header: "IO Months", get: (c) => c.cur("io_months") },
  { header: "Fixed Period", get: (c) => c.cur("fixed_period_months") },
  { header: "Product Type", get: (c) => c.cur("product_type") },
  { header: "Prepay Penalty Term", get: (c) => c.cur("prepay_term_months") },
  { header: "Prepay Penalty Type", get: (c) => c.cur("prepay_type") },
  { header: "Citizenship", get: (c) => c.cur("guarantor_citizenship", 1) },
  { header: "Foreign National Flag", get: (c) => c.cur("foreign_national_flag") },
  { header: "ITIN Flag", get: (c) => c.cur("itin_flag") },
  { header: "Monthly Insurance", get: (c) => c.cur("monthly_insurance") },
  { header: "Monthly Tax", get: (c) => c.cur("monthly_taxes") },
  { header: "Monthly P&I", get: (c) => c.cur("principal_and_interest") },
  { header: "Monthly PITI", get: (c) => c.cur("monthly_piti") },
  { header: "Application Date", get: (c) => c.cur("application_date") },
  { header: "Closing Date", get: (c) => c.cur("closing_date") },
  { header: "Estimated Disbursment Date", get: (c) => c.cur("disbursement_date") },
  { header: "First Payment Date", get: (c) => c.cur("first_payment_date") },
  { header: "Origination Points", get: (c) => c.cur("origination_fee_pct") },
  { header: "Escrows at Close", get: (c) => c.cur("reserve_amount") },
  { header: "Investor Name", get: (c) => c.cur("investor_name") },
  { header: "Investor Lock Date", get: (c) => c.cur("lock_date") },
  { header: "Investor Lock Expiration Date", get: (c) => c.cur("lock_expiration_date") },
  { header: "Investor Lock Price", get: (c) => c.cur("lock_price") },
  { header: "Servicer ID", get: (c) => c.cur("servicing_number") },
  { header: "MERs MIN ID", get: (c) => c.cur("mers_min") },
  { header: "ULI", get: (c) => c.cur("uli") },
  { header: "Day Count (360, 365)", get: (c) => c.cur("day_count") },
];

const cell = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return ""; // blanks stay blank
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build the data-tape CSV. `propertyIdxs` is one entry per property (default [1]). */
export function buildDataTapeCsv(ctx: TapeCtx, propertyIdxs: number[] = [1]): string {
  const header = DATA_TAPE_COLUMNS.map((c) => cell(c.header)).join(",");
  const rows = propertyIdxs.map((p) =>
    DATA_TAPE_COLUMNS.map((c) => cell(c.get(ctx, p))).join(","),
  );
  return [header, ...rows].join("\r\n");
}
