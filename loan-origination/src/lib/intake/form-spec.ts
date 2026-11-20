/**
 * The native intake form — one universal form for every deal type.
 *
 * This spec is the single definition of the form: ordered sections, the fields in each,
 * which are required, and the conditional rules that reveal product-specific blocks. It is
 * self-contained (carries its own label/type/options) so the form renders correctly even
 * before the new dictionary fields are re-imported into `field_definitions`; the keys match
 * the Program Config "Loan Data" dictionary, which is where the values are stored and
 * snapshotted. See docs/intake-crm-design.md §5.
 *
 * Pure module (no server-only imports) — imported by both the client form and `openDeal`.
 */

export type IntakeFieldType = "text" | "email" | "tel" | "number" | "currency" | "date" | "select" | "textarea";

export type IntakeFieldSpec = {
  key: string; // dictionary key
  label: string;
  type: IntakeFieldType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  half?: boolean; // render two-up on wide screens
};

export type IntakeSectionSpec = {
  id: string;
  title: string;
  blurb?: string;
  /** Show this whole section only when the predicate passes (always shown when absent). */
  when?: (v: Record<string, string>) => boolean;
  fields: IntakeFieldSpec[];
};

// Predicates over the current form values (all values are strings in the form state).
const isPurchase = (v: Record<string, string>) => /purchase/i.test(v.loan_purpose ?? "");
const isRefinance = (v: Record<string, string>) => /refinance/i.test(v.loan_purpose ?? "");
const isLongTerm = (v: Record<string, string>) => /long/i.test(v.term_preference ?? "");
const hasProject = (v: Record<string, string>) => /construction|renovation/i.test(v.rehab_type ?? "");

export const INTAKE_FORM_SPEC: IntakeSectionSpec[] = [
  {
    id: "contact",
    title: "Contact",
    fields: [
      { key: "guarantor_first_name", label: "Borrower first name", type: "text", required: true, half: true },
      { key: "guarantor_last_name", label: "Borrower last name", type: "text", required: true, half: true },
      { key: "borrower_email", label: "Borrower email", type: "email", required: true, half: true },
      { key: "borrower_phone", label: "Borrower phone", type: "tel", required: true, half: true },
      {
        key: "heard_about_us",
        label: "How did you hear about us?",
        type: "select",
        required: true,
        options: ["Searched online", "An AI assistant", "Someone at Sphinx Capital", "A broker partner or friend", "Other"],
      },
      { key: "broker_name", label: "Broker / referral partner name", type: "text", half: true, help: "If a broker or referral partner is involved." },
      { key: "broker_email", label: "Broker / referral partner email", type: "email", half: true },
      { key: "broker_phone", label: "Broker / referral partner phone", type: "tel", half: true },
    ],
  },
  {
    id: "property",
    title: "Property",
    fields: [
      { key: "property_street", label: "Street address", type: "text", required: true },
      { key: "property_city", label: "City", type: "text", half: true },
      { key: "property_state", label: "State", type: "text", half: true, placeholder: "ST" },
      { key: "property_zip", label: "ZIP", type: "text", required: true, half: true },
      {
        key: "property_type",
        label: "Property type",
        type: "select",
        required: true,
        options: [
          "SFR", "2-4 Unit", "Condo", "Townhome", "Rental Portfolio", "Multifamily 5+", "Mixed Use",
          "Infill Lot", "Land", "Office", "Retail", "Hospitality", "Industrial", "Medical", "Agricultural", "Special Purpose",
        ],
      },
    ],
  },
  {
    id: "transaction",
    title: "Transaction",
    fields: [
      {
        key: "loan_purpose",
        label: "Purchase or refinance?",
        type: "select",
        required: true,
        options: ["Purchase", "Refinance - Rate and Term", "Refinance - Cash Out"],
      },
      {
        key: "term_preference",
        label: "Short- or long-term financing?",
        type: "select",
        required: true,
        options: ["Short-term (12-36 months)", "Long-term (30-year)"],
      },
      {
        key: "rehab_type",
        label: "Renovation or construction?",
        type: "select",
        options: ["None", "Renovation", "Construction"],
        help: "For short-term loans — are you requesting funds for work?",
      },
    ],
  },
  {
    id: "purchase",
    title: "Purchase details",
    when: isPurchase,
    fields: [
      { key: "purchase_price", label: "Purchase price", type: "currency", half: true },
      { key: "closing_date", label: "Contracted closing date", type: "date", half: true },
    ],
  },
  {
    id: "refinance",
    title: "Refinance details",
    when: isRefinance,
    fields: [
      { key: "original_purchase_date", label: "Original purchase date", type: "date", half: true },
      { key: "original_purchase_price", label: "Original purchase price", type: "currency", half: true },
      { key: "as_is_value", label: "Current value", type: "currency", half: true },
      { key: "payoff_amount", label: "Current amount owed", type: "currency", half: true },
      { key: "improvements_since_purchase", label: "Spent on improvements since purchase", type: "currency" },
    ],
  },
  {
    id: "project",
    title: "Project details",
    when: hasProject,
    fields: [
      { key: "rehab_budget", label: "Total budget", type: "currency", half: true },
      { key: "project_months", label: "Months to complete", type: "number", half: true },
      { key: "arv", label: "Expected completed value", type: "currency", half: true },
      { key: "exit_strategy", label: "Exit strategy", type: "select", options: ["Sale", "Refinance"], half: true },
    ],
  },
  {
    id: "rental",
    title: "Rental details",
    when: isLongTerm,
    fields: [
      { key: "monthly_rent", label: "Monthly income", type: "currency", half: true },
      { key: "annual_taxes", label: "Annual taxes", type: "currency", half: true },
      { key: "annual_insurance", label: "Annual insurance", type: "currency", half: true },
      { key: "annual_hoa", label: "Annual HOA", type: "currency", half: true },
    ],
  },
  {
    id: "borrower",
    title: "Borrower",
    fields: [
      { key: "borrower_entity", label: "Borrowing entity name", type: "text", required: true, help: "The LLC, Corp, or Trust that will be on title." },
      { key: "guarantor_fico", label: "Guarantor credit score", type: "number", required: true, half: true },
      { key: "liquid_assets", label: "Total liquid assets (all members)", type: "currency", required: true, half: true },
      { key: "net_worth", label: "Combined net worth (all members)", type: "currency", required: true, half: true },
      { key: "properties_owned_count", label: "Investment properties owned (all members)", type: "number", required: true, half: true },
      { key: "experience_property_count", label: "Properties sold in the past 3 years", type: "number", required: true, half: true },
      { key: "experience_summary", label: "Real estate experience", type: "textarea" },
      { key: "loan_request_summary", label: "Anything else we should know?", type: "textarea" },
    ],
  },
];

/** Every field key the form can submit, in order (for snapshot/seeding). */
export const INTAKE_FIELD_KEYS: string[] = INTAKE_FORM_SPEC.flatMap((s) => s.fields.map((f) => f.key));

const PROGRAM_LABEL: Record<string, string> = {
  bridge: "Bridge",
  fix_and_flip: "Fix & Flip",
  new_construction: "New Construction",
  dscr: "DSCR",
  commercial_bridge: "Commercial Bridge",
  commercial_new_construction: "Commercial New Construction",
  commercial_permanent: "Commercial Permanent",
};

// Property types that route a deal to the commercial program set.
const COMMERCIAL_TYPES = new Set([
  "Multifamily 5+", "Mixed Use", "Office", "Retail", "Hospitality", "Industrial", "Medical", "Agricultural", "Special Purpose",
]);

export type DerivedProgram = {
  key: string; // loan_programs.loan_type_key
  label: string; // display label for loans.loan_type
  loanProgram: "DSCR" | "RTL"; // the high-level loan_program field value
};

/**
 * Derive the loan program from the universal answers (§5.1), so one form serves every
 * product. Long-term → DSCR / Commercial Permanent; short-term splits by renovation vs.
 * construction vs. none; property type routes residential vs. commercial. Defaults to DSCR
 * when term preference is unset.
 */
export function deriveProgram(v: Record<string, unknown>): DerivedProgram {
  const propertyType = String(v.property_type ?? "");
  const commercial = COMMERCIAL_TYPES.has(propertyType);
  const term = String(v.term_preference ?? "");
  const rehab = String(v.rehab_type ?? "").toLowerCase();
  const shortTerm = /short/i.test(term);

  let key: string;
  if (!shortTerm) {
    key = commercial ? "commercial_permanent" : "dscr"; // long-term or unspecified
  } else if (rehab.includes("construction")) {
    key = commercial ? "commercial_new_construction" : "new_construction";
  } else if (rehab.includes("renovation")) {
    key = commercial ? "commercial_bridge" : "fix_and_flip";
  } else {
    key = commercial ? "commercial_bridge" : "bridge";
  }
  return {
    key,
    label: PROGRAM_LABEL[key] ?? "DSCR",
    loanProgram: key === "dscr" || key === "commercial_permanent" ? "DSCR" : "RTL",
  };
}
