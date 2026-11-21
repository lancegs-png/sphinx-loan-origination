import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * Fill the borrower Loan Application AcroForm (loan_application_2026.pdf) from the submitted answers,
 * flatten it, and append an authentication-certificate page — producing the signed PDF stored on the
 * Documents tab. Values are the form's spec keys (same keys the form collects); co-guarantor keys are
 * `cog_*`. The REO tables are collected separately, so their first cell reads "See attached".
 */

type Vals = Record<string, string>;

export type ApplicationSignMeta = {
  loanRef: string;
  guarantorSigner: string;
  coguarantorSigner?: string | null;
  email: string;
  ip: string | null;
  signedAt: Date;
  sentTo?: string | null;
  sentAt?: string | null;
};

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function fullName(v: Vals, prefix: string): string {
  return [v[`${prefix}guarantor_first_name`], v[`${prefix}guarantor_last_name`]].filter(Boolean).join(" ").trim();
}

const PTYPE_MAP: Record<string, string> = {
  SFR: "ptype_sfr",
  Townhome: "ptype_sfr",
  "2-4 Unit": "ptype_two_four",
  "Multifamily 5+": "ptype_multi",
  "Mixed Use": "ptype_mixed",
  "Rental Portfolio": "ptype_portfolio",
  Condo: "ptype_condo",
  "Infill Lot": "ptype_lot",
  Land: "ptype_land_parcel",
  Office: "ptype_other_commercial",
  Retail: "ptype_other_commercial",
  Hospitality: "ptype_other_commercial",
  Industrial: "ptype_other_commercial",
  Medical: "ptype_other_commercial",
  Agricultural: "ptype_other_commercial",
  "Special Purpose": "ptype_other_commercial",
};

/** PDF text field name -> value. Empty/undefined values are skipped by the filler. */
function textMap(v: Vals): Record<string, string> {
  return {
    borrower_entity_name: v.borrower_entity,
    borrower_ein: v.entity_ein,
    borrower_entity_members: v.entity_member_name,
    prop_street: v.property_street,
    prop_city: v.property_city,
    prop_state: v.property_state,
    prop_zip: v.property_zip,
    num_units: v.unit_count,
    num_properties: v.portfolio_property_count,
    exit_timeline: v.exit_timeline_months,
    pur_close: v.closing_date,
    pur_price: v.purchase_price,
    pur_asis: v.as_is_value,
    pur_arv: v.arv,
    pur_renobudget: v.rehab_budget,
    pur_renotime: v.project_months,
    pur_improvements: v.improvements_description,
    ref_acq_date: v.original_purchase_date,
    ref_orig_price: v.original_purchase_price,
    ref_lender: v.existing_lender_name,
    ref_maturity: v.existing_loan_maturity_date,
    ref_asis: v.as_is_value,
    ref_payoff: v.payoff_amount,
    ref_renobudget: v.rehab_budget,
    ref_renotime: v.project_months,
    ref_improvements: v.improvements_description,
    g_name: fullName(v, ""),
    g_ssn: v.guarantor_ssn,
    g_dob: v.guarantor_dob,
    g_phone: v.guarantor_phone,
    g_email: v.guarantor_email,
    g_address: v.guarantor_address,
    g_years: v.guarantor_years_at_address,
    g_credit: v.guarantor_fico,
    cg_name: fullName(v, "cog_"),
    cg_ssn: v.cog_guarantor_ssn,
    cg_dob: v.cog_guarantor_dob,
    cg_phone: v.cog_guarantor_phone,
    cg_email: v.cog_guarantor_email,
    cg_address: v.cog_guarantor_address,
    cg_years: v.cog_guarantor_years_at_address,
    cg_credit: v.cog_guarantor_fico,
    assets_total: v.liquid_assets,
    g_employer: v.guarantor_employer,
    g_occupation: v.guarantor_occupation,
    g_annual_income: v.guarantor_annual_income,
    g_annual_inv_income: v.guarantor_investment_income,
    cg_employer: v.cog_guarantor_employer,
    cg_occupation: v.cog_guarantor_occupation,
    cg_annual_income: v.cog_guarantor_annual_income,
    cg_annual_inv_income: v.cog_guarantor_investment_income,
    geo_experience: v.experience_geography,
    capacity: v.experience_capacity,
    exp_rehab3y: v.experience_property_count,
    exp_currentrentals: v.properties_owned_count,
    exp_groundup3y: v.experience_groundup_count,
    exp_career_rehab: v.experience_total_rehab_count,
    exp_years_investor: v.experience_years,
    exp_licensed_5y: v.experience_licensed,
    exp_company_website: v.company_website,
    pdec_explanation: v.decl_explanation,
    additional_commentary: v.loan_request_summary,
    // REO Owned / Sold tables are collected as a separate document.
    reo_r1_c1: "See attached",
    res_r1_c1: "See attached",
  };
}

/** PDF checkbox field names to check (on-state "/Yes"). */
function checkedBoxes(v: Vals): string[] {
  const boxes: string[] = [];
  const purpose = v.loan_purpose ?? "";
  const rehab = (v.rehab_type ?? "").toLowerCase();
  const isReno = rehab.includes("renovation");
  const isConst = rehab.includes("construction");
  if (/purchase/i.test(purpose)) {
    boxes.push(isConst ? "purpose_purchase_const" : isReno ? "purpose_purchase_reno" : "purpose_purchase");
  } else if (/cash/i.test(purpose)) {
    boxes.push("purpose_refi_co");
    if (isConst) boxes.push("purpose_refi_const");
    else if (isReno) boxes.push("purpose_refi_reno");
  } else if (/refinance/i.test(purpose)) {
    boxes.push(isConst ? "purpose_refi_const" : isReno ? "purpose_refi_reno" : "purpose_refi_rt");
  }

  const pt = PTYPE_MAP[v.property_type ?? ""];
  if (pt) boxes.push(pt);

  if (/sale/i.test(v.exit_strategy ?? "")) boxes.push("exit_sale");
  else if (/refinance/i.test(v.exit_strategy ?? "")) boxes.push("exit_refi");

  if (v.guarantor_marital_status === "Married") boxes.push("g_marital_married");
  else if (v.guarantor_marital_status === "Unmarried") boxes.push("g_marital_unmarried");
  if (v.guarantor_residence_ownership === "Own") boxes.push("g_ownership_own");
  else if (v.guarantor_residence_ownership === "Rent") boxes.push("g_ownership_rent");
  if (v.cog_guarantor_marital_status === "Married") boxes.push("cg_marital_married");
  else if (v.cog_guarantor_marital_status === "Unmarried") boxes.push("cg_marital_unmarried");
  if (v.cog_guarantor_residence_ownership === "Own") boxes.push("cg_ownership_own");
  else if (v.cog_guarantor_residence_ownership === "Rent") boxes.push("cg_ownership_rent");

  // Personal declarations (guarantor column).
  const pdec: [string, string][] = [
    ["decl_judgments", "pdec_q1"],
    ["decl_bankruptcy", "pdec_q2"],
    ["decl_foreclosure", "pdec_q3"],
    ["decl_lawsuit", "pdec_q4"],
    ["decl_loan_foreclosed", "pdec_q5"],
    ["decl_fed_delinquent", "pdec_q6"],
    ["decl_felony", "pdec_q7"],
  ];
  for (const [k, q] of pdec) {
    if (v[k] === "Yes") boxes.push(`${q}_g_yes`);
    else if (v[k] === "No") boxes.push(`${q}_g_no`);
  }
  const cit = v.guarantor_citizenship ?? "";
  if (cit) {
    boxes.push(cit === "U.S. Citizen" ? "pdec_q8_g_yes" : "pdec_q8_g_no");
    boxes.push(cit === "Permanent Resident" ? "pdec_q9_g_yes" : "pdec_q9_g_no");
  }

  // Property declarations.
  const prop: [string, string][] = [
    ["decl_occupy", "prop_q1"],
    ["decl_ever_occupied", "prop_q2"],
    ["decl_under_construction", "prop_q3"],
    ["decl_hazards", "prop_q4"],
    ["decl_seller_relationship", "prop_q5"],
    ["decl_wholesaler", "prop_q6"],
    ["decl_down_payment_borrowed", "prop_q7"],
    ["decl_short_sale", "prop_q8"],
  ];
  for (const [k, q] of prop) {
    if (v[k] === "Yes") boxes.push(`${q}_yes`);
    else if (v[k] === "No") boxes.push(`${q}_no`);
  }
  return boxes;
}

export async function fillApplicationPdf(values: Vals, meta: ApplicationSignMeta): Promise<Uint8Array> {
  const file = path.join(process.cwd(), "src/lib/templates/files", "loan_application_2026.pdf");
  const pdf = await PDFDocument.load(readFileSync(file));
  const form = pdf.getForm();

  const setText = (name: string, value: string | undefined) => {
    if (!value) return;
    try {
      form.getTextField(name).setText(value);
    } catch {
      /* field absent or not a text field */
    }
  };
  const check = (name: string) => {
    try {
      form.getCheckBox(name).check();
    } catch {
      /* field absent or not a checkbox */
    }
  };

  for (const [name, value] of Object.entries(textMap(values))) setText(name, value);
  for (const name of checkedBoxes(values)) check(name);

  // Signatures (typed e-signature, like the term sheet).
  setText("sig_guarantor", meta.guarantorSigner);
  setText("sig_guarantor_date", fmtDate(meta.signedAt));
  if (meta.coguarantorSigner) {
    setText("sig_coguarantor", meta.coguarantorSigner);
    setText("sig_coguarantor_date", fmtDate(meta.signedAt));
  }

  form.flatten();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  appendCertificatePage(pdf, meta, font);
  return pdf.save();
}

/** Append an authentication-certificate page mirroring the term sheet's audit record. */
function appendCertificatePage(pdf: PDFDocument, meta: ApplicationSignMeta, font: PDFFont): void {
  const page = pdf.addPage([612, 792]);
  const { height, width } = page.getSize();
  const left = 56;
  let y = height - 72;

  const line = (text: string, size = 10, color = rgb(0.1, 0.1, 0.1)) => {
    page.drawText(text, { x: left, y, size, font, color });
    y -= size + 6;
  };

  page.drawText("Authentication Certificate", { x: left, y, size: 16, font, color: rgb(0, 0, 0) });
  y -= 28;
  page.drawLine({ start: { x: left, y }, end: { x: width - left, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 20;

  line(`Document: Loan Application — ${meta.loanRef}`);
  line(`Signed by: ${meta.guarantorSigner}`);
  if (meta.coguarantorSigner) line(`Co-signed by: ${meta.coguarantorSigner}`);
  line(`Email: ${meta.email || "—"}`);
  line(`Signed at (UTC): ${meta.signedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`);
  line(`IP address: ${meta.ip ?? "unknown"}`);
  if (meta.sentTo) line(`Sent to: ${meta.sentTo}`);
  if (meta.sentAt) line(`Sent at: ${meta.sentAt}`);
  y -= 10;
  line(
    "The signer(s) above adopted an electronic signature and submitted this application as an electronic",
    9,
    rgb(0.35, 0.35, 0.35),
  );
  line(
    "record under applicable federal and state e-signature law. This certificate records that consent.",
    9,
    rgb(0.35, 0.35, 0.35),
  );
}
