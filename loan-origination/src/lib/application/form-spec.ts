/**
 * The borrower Loan Application — the detailed form the borrower completes via a shareable link AFTER
 * the term sheet is signed (distinct from the shorter intake form). Reuses the intake form's section/
 * field spec types so the same `Field` renderer can draw it, with per-field `required` and `when`.
 *
 * Pure module (no server-only imports). Keys:
 *  - Primary fields use the real `field_definitions` key (idx 1) — these prefill from the loan.
 *  - Co-guarantor fields use a `cog_<key>` convention; the submit action maps them to the same
 *    dictionary key at idx 2 (co-guarantor = guarantor repeat-group row 2).
 *  - `decl_*` fields are personal/property declarations — stored in the application SNAPSHOT (and the
 *    citizenship answers also write `guarantor_citizenship`), not as first-class dictionary fields.
 *  - `has_coguarantor` is a form-only control that reveals the co-guarantor block.
 * Repeating groups (additional entity members, the asset table, additional properties) are collected
 * as snapshot rows by the form component; this spec defines the single-row/primary fields.
 */
import type { IntakeSectionSpec } from "@/lib/intake/form-spec";

// Options reused from the intake dictionary so prefilled values match an option exactly.
const LOAN_PURPOSE = ["Purchase", "Refinance - Rate and Term", "Refinance - Cash Out"];
const REHAB_TYPE = ["None", "Renovation", "Construction"];
const PROPERTY_TYPE = [
  "SFR", "2-4 Unit", "Condo", "Townhome", "Rental Portfolio", "Multifamily 5+", "Mixed Use",
  "Infill Lot", "Land", "Office", "Retail", "Hospitality", "Industrial", "Medical", "Agricultural", "Special Purpose",
];
const EXIT_STRATEGY = ["Sale", "Refinance"];
const YES_NO = ["Yes", "No"];

type V = Record<string, string>;
const isPurchase = (v: V) => /purchase/i.test(v.loan_purpose ?? "");
const isRefinance = (v: V) => /refinance/i.test(v.loan_purpose ?? "");
const hasReno = (v: V) => /renovation|construction/i.test(v.rehab_type ?? "");
const isPurchaseReno = (v: V) => isPurchase(v) && hasReno(v);
const isMultiUnit = (v: V) => /2-4 Unit|Multifamily|Mixed Use/i.test(v.property_type ?? "");
const isPortfolio = (v: V) => /Rental Portfolio/i.test(v.property_type ?? "") || !!(v.portfolio_property_count ?? "").trim();
const hasCoguarantor = (v: V) => (v.has_coguarantor ?? "") === "Yes";
const anyPersonalYes = (v: V) =>
  ["decl_judgments", "decl_bankruptcy", "decl_foreclosure", "decl_lawsuit", "decl_loan_foreclosed", "decl_fed_delinquent", "decl_felony"]
    .some((k) => (v[k] ?? "") === "Yes");

export const APPLICATION_FORM_SPEC: IntakeSectionSpec[] = [
  {
    id: "entity",
    title: "Borrowing Entity",
    fields: [
      { key: "borrower_entity", label: "Borrowing entity legal name", type: "text", required: true },
      { key: "entity_ein", label: "EIN", type: "text", required: true, half: true },
      { key: "entity_member_name", label: "Entity member name(s)", type: "text", help: "Primary member; add others in Additional Information." },
    ],
  },
  {
    id: "property",
    title: "Property & Purpose",
    fields: [
      { key: "property_street", label: "Subject property street address", type: "text", required: true },
      { key: "property_city", label: "City", type: "text", required: true, half: true },
      { key: "property_state", label: "State", type: "text", required: true, half: true, placeholder: "ST" },
      { key: "property_zip", label: "ZIP", type: "text", required: true, half: true },
      { key: "loan_purpose", label: "Purpose of loan", type: "select", required: true, options: LOAN_PURPOSE },
      { key: "rehab_type", label: "Renovation or construction?", type: "select", required: true, options: REHAB_TYPE },
      { key: "property_type", label: "Property type", type: "select", required: true, options: PROPERTY_TYPE },
      { key: "unit_count", label: "Number of units", type: "number", half: true, when: isMultiUnit, required: true },
      { key: "portfolio_property_count", label: "Number of properties (portfolio)", type: "number", half: true, when: isPortfolio, required: true },
      { key: "exit_strategy", label: "Exit strategy", type: "select", required: true, half: true, options: EXIT_STRATEGY },
      { key: "exit_timeline_months", label: "Expected timeline to exit (months)", type: "number", half: true },
    ],
  },
  {
    id: "purchase",
    title: "Purchase details",
    when: isPurchase,
    fields: [
      { key: "closing_date", label: "Expected closing date", type: "date", required: true, half: true },
      { key: "purchase_price", label: "Purchase price", type: "currency", required: true, half: true },
      { key: "as_is_value", label: "As-is value", type: "currency", required: true, half: true },
      { key: "arv", label: "Expected ARV", type: "currency", half: true, when: isPurchaseReno, required: true },
      { key: "rehab_budget", label: "Renovation budget", type: "currency", half: true, when: isPurchaseReno, required: true },
      { key: "project_months", label: "Renovation timeframe (months)", type: "number", half: true },
      { key: "improvements_description", label: "Describe improvements to be completed", type: "textarea" },
    ],
  },
  {
    id: "refinance",
    title: "Refinance details",
    when: isRefinance,
    fields: [
      { key: "original_purchase_date", label: "Date acquired", type: "date", required: true, half: true },
      { key: "original_purchase_price", label: "Original purchase price", type: "currency", required: true, half: true },
      { key: "existing_lender_name", label: "Current lender", type: "text", half: true },
      { key: "existing_loan_maturity_date", label: "Loan maturity date", type: "date", half: true },
      { key: "as_is_value", label: "As-is value", type: "currency", required: true, half: true },
      { key: "payoff_amount", label: "Existing payoff amount", type: "currency", required: true, half: true },
      { key: "rehab_budget", label: "Renovation budget (if any)", type: "currency", half: true },
      { key: "project_months", label: "Renovation timeframe (months)", type: "number", half: true },
      { key: "improvements_description", label: "Describe improvements (done or planned)", type: "textarea" },
    ],
  },
  {
    id: "guarantor",
    title: "Guarantor",
    fields: [
      { key: "guarantor_first_name", label: "Guarantor first name", type: "text", required: true, half: true },
      { key: "guarantor_last_name", label: "Guarantor last name", type: "text", required: true, half: true },
      { key: "guarantor_ssn", label: "Social Security #", type: "text", required: true, half: true, help: "Used for your credit review; stored securely." },
      { key: "guarantor_dob", label: "Date of birth", type: "date", required: true, half: true },
      { key: "guarantor_phone", label: "Phone number", type: "tel", required: true, half: true },
      { key: "guarantor_email", label: "Email", type: "email", required: true, half: true },
      { key: "guarantor_address", label: "Present address (street, city, state, ZIP)", type: "text", required: true },
      { key: "guarantor_marital_status", label: "Marital status", type: "select", required: true, half: true, options: ["Married", "Unmarried"] },
      { key: "guarantor_residence_ownership", label: "Do you own or rent?", type: "select", required: true, half: true, options: ["Own", "Rent"] },
      { key: "guarantor_years_at_address", label: "Years at present address", type: "number", required: true, half: true },
      { key: "guarantor_fico", label: "Credit score (self-reported)", type: "number", required: true, half: true },
      { key: "guarantor_citizenship", label: "Citizenship", type: "select", required: true, half: true, options: ["U.S. Citizen", "Permanent Resident", "Foreign National"] },
      { key: "has_coguarantor", label: "Is there a co-guarantor?", type: "select", required: true, options: YES_NO },
    ],
  },
  {
    id: "coguarantor",
    title: "Co-guarantor",
    when: hasCoguarantor,
    fields: [
      { key: "cog_guarantor_first_name", label: "Co-guarantor first name", type: "text", required: true, half: true },
      { key: "cog_guarantor_last_name", label: "Co-guarantor last name", type: "text", required: true, half: true },
      { key: "cog_guarantor_ssn", label: "Social Security #", type: "text", required: true, half: true },
      { key: "cog_guarantor_dob", label: "Date of birth", type: "date", required: true, half: true },
      { key: "cog_guarantor_phone", label: "Phone number", type: "tel", required: true, half: true },
      { key: "cog_guarantor_email", label: "Email", type: "email", required: true, half: true },
      { key: "cog_guarantor_address", label: "Present address", type: "text", required: true },
      { key: "cog_guarantor_marital_status", label: "Marital status", type: "select", required: true, half: true, options: ["Married", "Unmarried"] },
      { key: "cog_guarantor_residence_ownership", label: "Do you own or rent?", type: "select", required: true, half: true, options: ["Own", "Rent"] },
      { key: "cog_guarantor_years_at_address", label: "Years at present address", type: "number", required: true, half: true },
      { key: "cog_guarantor_fico", label: "Credit score (self-reported)", type: "number", required: true, half: true },
      { key: "cog_guarantor_citizenship", label: "Citizenship", type: "select", required: true, half: true, options: ["U.S. Citizen", "Permanent Resident", "Foreign National"] },
    ],
  },
  {
    id: "assets_income",
    title: "Assets & Income",
    blurb: "List your largest accounts under Additional Information if more than one.",
    fields: [
      { key: "liquid_assets", label: "Total liquidity (all accounts)", type: "currency", required: true, half: true },
      { key: "net_worth", label: "Combined net worth", type: "currency", required: true, half: true },
      { key: "guarantor_employer", label: "Employer", type: "text", required: true, half: true },
      { key: "guarantor_occupation", label: "Occupation", type: "text", required: true, half: true },
      { key: "guarantor_annual_income", label: "Annual income", type: "currency", required: true, half: true },
      { key: "guarantor_investment_income", label: "Annual investment income", type: "currency", required: true, half: true },
    ],
  },
  {
    id: "experience",
    title: "Real Estate Experience",
    fields: [
      { key: "experience_property_count", label: "Properties rehabbed in the past 3 years", type: "number", required: true, half: true },
      { key: "properties_owned_count", label: "Properties currently owned as rentals", type: "number", required: true, half: true },
      { key: "experience_total_rehab_count", label: "Properties ever purchased & rehabbed", type: "number", required: true, half: true },
      { key: "experience_years", label: "Years as a real estate investor", type: "number", required: true, half: true },
      { key: "experience_groundup_count", label: "Ground-up projects completed (past 3 years)", type: "number", half: true },
      { key: "experience_licensed", label: "Licensed contractor or agent in the past 5 years?", type: "select", half: true, options: YES_NO },
      { key: "experience_geography", label: "Geographic areas of experience", type: "text" },
      { key: "experience_capacity", label: "Capacity (investor, contractor, realtor, …)", type: "text" },
      { key: "company_website", label: "Company website", type: "text" },
    ],
  },
  {
    id: "declarations_personal",
    title: "Personal Declarations",
    blurb: "Answer for the guarantor (and co-guarantor). If any answer is Yes, explain below.",
    fields: [
      { key: "decl_judgments", label: "Any outstanding judgments?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_bankruptcy", label: "Declared bankrupt in the past 4 years?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_foreclosure", label: "Property foreclosed / deed-in-lieu in the last 4 years?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_lawsuit", label: "Party to a lawsuit?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_loan_foreclosed", label: "Obligated on a loan that resulted in foreclosure/judgment?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_fed_delinquent", label: "Delinquent or in default on federal debt / other obligation?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_felony", label: "Ever charged with or convicted of a felony?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_explanation", label: "Explanation (if any Yes above)", type: "textarea", when: anyPersonalYes, required: true },
    ],
  },
  {
    id: "declarations_property",
    title: "Property Declarations",
    fields: [
      { key: "decl_occupy", label: "Do you occupy or intend to occupy the subject property?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_ever_occupied", label: "Have you ever occupied it?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_under_construction", label: "Is the property currently under construction?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_hazards", label: "Any known hazards or safety issues?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_seller_relationship", label: "Relationship with the seller, closing, or title agent?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_wholesaler", label: "Is the property being purchased from a wholesaler?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_down_payment_borrowed", label: "Will any part of the down payment be borrowed?", type: "select", required: true, half: true, options: YES_NO },
      { key: "decl_short_sale", label: "Is this subject to short-sale approval by the existing lender?", type: "select", required: true, half: true, options: YES_NO },
    ],
  },
  {
    id: "additional",
    title: "Additional Information",
    fields: [
      { key: "loan_request_summary", label: "Anything else we should know?", type: "textarea" },
    ],
  },
  {
    id: "acknowledgment",
    title: "Acknowledgment & Signature",
    blurb:
      "By typing your name below you adopt it as your electronic signature and certify that the information in this application is true and complete to the best of your knowledge, and authorize the lender to verify it and obtain consumer credit reports.",
    fields: [
      { key: "ack_consent", label: "I have read and agree to the acknowledgment above", type: "select", required: true, options: ["Yes"] },
      { key: "sig_guarantor_name", label: "Guarantor — type your full legal name to sign", type: "text", required: true },
      { key: "sig_coguarantor_name", label: "Co-guarantor — type full legal name to sign", type: "text", required: true, when: hasCoguarantor },
    ],
  },
];

/** Every spec key, in order (for snapshot/seeding). */
export const APPLICATION_FIELD_KEYS: string[] = APPLICATION_FORM_SPEC.flatMap((s) => s.fields.map((f) => f.key));

/** Form-only control keys that are NOT persisted as field values. */
export const APPLICATION_CONTROL_KEYS = new Set(["has_coguarantor"]);

/** Co-guarantor spec keys (`cog_<dictkey>`) → the dictionary key written at idx 2. */
export function coguarantorDictKey(specKey: string): string | null {
  return specKey.startsWith("cog_") ? specKey.slice("cog_".length) : null;
}
