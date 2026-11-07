// Template registry (Template Map tab). Drives the Templates tab: each template's
// program, stage, branding, whether it needs verified values, and its required loan
// fields (dictionary keys) — used to show the green "ready" state. Config-sourced
// values (lender signer, servicer, note buyer) are not listed here; they come from
// company config at generation time.

export type Branding = "sphinx" | "white_label";

export type TemplateDef = {
  id: string;
  name: string;
  program: "dscr" | "rtl" | "both";
  stage: string;
  branding: Branding;
  requiresVerified: boolean;
  requiredKeys: string[]; // dictionary field keys that must have a current value
  generatable: boolean; // wired for download now
  format: "docx" | "pdf" | "xlsx";
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "dscr_loi",
    name: "DSCR LOI",
    program: "dscr",
    stage: "quote_term_sheet",
    branding: "sphinx",
    requiresVerified: false,
    requiredKeys: [
      "term_sheet_date", "guarantor_first_name", "guarantor_last_name", "loan_amount",
      "guarantor_fico", "interest_rate", "as_is_value", "loan_program", "ltv",
      "property_type", "prepay_type", "loan_term_months", "dscr", "loan_purpose",
      "amortization_term_months", "borrower_entity", "reserve_months",
      "principal_and_interest", "origination_fee_pct", "underwriting_fee", "legal_fee",
      "property_address",
    ],
    generatable: true,
    format: "docx",
  },
  {
    id: "dscr_commitment",
    name: "DSCR Commitment Letter",
    program: "dscr",
    stage: "underwriting",
    branding: "sphinx",
    requiresVerified: true,
    requiredKeys: [
      "commitment_date", "guarantor_first_name", "guarantor_last_name", "loan_amount",
      "guarantor_fico", "interest_rate", "as_is_value", "ltv", "property_type",
      "prepay_type", "loan_term_months", "dscr", "loan_purpose", "borrower_entity",
      "principal_and_interest", "origination_fee_pct", "underwriting_fee", "legal_fee",
      "property_address",
    ],
    generatable: false,
    format: "docx",
  },
  {
    id: "rtl_loi_sphinx",
    name: "RTL LOI (Sphinx)",
    program: "rtl",
    stage: "quote_term_sheet",
    branding: "sphinx",
    requiresVerified: false,
    requiredKeys: [
      "term_sheet_date", "borrower_entity", "guarantor_first_name", "guarantor_last_name",
      "purchase_price", "rehab_budget", "arv", "initial_loan_amount", "total_loan_amount",
      "ltc_total", "arltv", "interest_rate", "loan_term_months", "property_address",
    ],
    generatable: false,
    format: "docx",
  },
  {
    id: "rtl_loi_wl",
    name: "RTL LOI (White Label)",
    program: "rtl",
    stage: "quote_term_sheet",
    branding: "white_label",
    requiresVerified: false,
    requiredKeys: [
      "white_label_lender_name", "term_sheet_date", "borrower_entity", "guarantor_first_name",
      "purchase_price", "rehab_budget", "arv", "total_loan_amount", "arltv", "interest_rate",
      "property_address",
    ],
    generatable: false,
    format: "docx",
  },
  {
    id: "rtl_commitment_sphinx",
    name: "RTL Commitment Letter (Sphinx)",
    program: "rtl",
    stage: "underwriting",
    branding: "sphinx",
    requiresVerified: true,
    requiredKeys: [
      "commitment_date", "borrower_entity", "guarantor_first_name", "total_loan_amount",
      "arltv", "interest_rate", "property_address",
    ],
    generatable: false,
    format: "docx",
  },
  {
    id: "rtl_commitment_wl",
    name: "RTL Commitment Letter (White Label)",
    program: "rtl",
    stage: "underwriting",
    branding: "white_label",
    requiresVerified: true,
    requiredKeys: [
      "white_label_lender_name", "commitment_date", "borrower_entity", "total_loan_amount",
      "arltv", "interest_rate", "property_address",
    ],
    generatable: false,
    format: "docx",
  },
  {
    id: "first_payment_letter",
    name: "First Payment Letter",
    program: "both",
    stage: "closing",
    branding: "sphinx",
    requiresVerified: true,
    requiredKeys: [
      "servicing_number", "closing_date", "borrower_entity", "borrower_email",
      "property_address", "servicer_name", "principal_and_interest", "monthly_taxes",
      "monthly_insurance", "monthly_piti", "first_payment_date",
    ],
    generatable: false,
    format: "docx",
  },
  {
    id: "assignment_allonge",
    name: "Assignment & Allonge",
    program: "both",
    stage: "closing",
    branding: "sphinx",
    requiresVerified: true,
    requiredKeys: [
      "borrower_entity", "closing_date", "loan_amount", "property_address", "legal_description",
    ],
    generatable: false,
    format: "docx",
  },
  {
    id: "ach_form",
    name: "ACH Form",
    program: "both",
    stage: "closing",
    branding: "sphinx",
    requiresVerified: true,
    requiredKeys: ["servicing_number", "borrower_entity", "borrower_phone", "borrower_email", "monthly_piti"],
    generatable: false,
    format: "docx",
  },
  {
    id: "data_tape",
    name: "Data Tape",
    program: "both",
    stage: "closing",
    branding: "sphinx",
    requiresVerified: true,
    requiredKeys: ["loan_amount", "interest_rate", "property_address", "guarantor_first_name"],
    generatable: false,
    format: "xlsx",
  },
];

export type Readiness = { ready: boolean; missing: string[] };

/** Which required keys lack a current value (verified ?? initial) for this loan. */
export function templateReadiness(
  def: TemplateDef,
  hasValue: (key: string) => boolean,
): Readiness {
  const missing = def.requiredKeys.filter((k) => !hasValue(k));
  return { ready: missing.length === 0, missing };
}

/** Templates applicable to a loan's program (program-specific + "both"). */
export function templatesForProgram(programKey: string | null): TemplateDef[] {
  const p = (programKey ?? "").toLowerCase();
  return TEMPLATES.filter((t) => t.program === "both" || t.program === p);
}
