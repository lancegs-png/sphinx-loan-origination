import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { propertyStreet } from "@/lib/documents/naming";
import { findDealFolderByStreet, createDealDashboard } from "./drive";
import { writeCells, sheetUrl } from "./sheets";

/**
 * DSCR dashboard field map (app → sheet, one-way push). Bound to the "DSCR Deal Dashboard
 * - Template" — see docs/google-sync/dscr-dashboard-cell-map.md.
 *
 * Two tabs carry data: `Loan Data` (the human view) and `Data Tape` (the investor tape,
 * row 2). Most Data Tape columns are formulas pulling from Loan Data, so they fill in
 * automatically — only the tape's own input columns (the fields Loan Data doesn't have)
 * are written here. Formula cells (B5 Loan Amount, DSCR / PITI / Net Wire, every Data Tape
 * `=` column) are intentionally omitted so the dashboard's own math is never clobbered.
 *
 * Keys use the loadFieldValues form (idx 1 bare, idx 2 as `key#2`). B2 Loan Number comes
 * from the loans row, not a field value.
 */
export const LOAN_DATA_CELLS: { cell: string; key: string }[] = [
  // Loan Information
  { cell: "B3", key: "application_date" },
  { cell: "B4", key: "product_type" },
  { cell: "B6", key: "loan_purpose" },
  { cell: "B7", key: "interest_rate" },
  { cell: "B8", key: "prepay_term_months" },
  { cell: "B9", key: "prepay_type" },
  { cell: "B10", key: "ltv" },
  { cell: "B11", key: "origination_fee_pct" },
  { cell: "B12", key: "loan_term_months" },
  { cell: "B13", key: "reserve_months" },
  { cell: "B14", key: "io_months" },
  // Property Information
  { cell: "B17", key: "property_address" },
  { cell: "B18", key: "property_street" },
  { cell: "B19", key: "property_city" },
  { cell: "B20", key: "property_state" },
  { cell: "B21", key: "property_zip" },
  { cell: "B22", key: "property_type" },
  { cell: "B23", key: "unit_count" },
  { cell: "B24", key: "occupancy" },
  { cell: "B25", key: "as_is_value" },
  { cell: "B26", key: "purchase_price" },
  { cell: "B27", key: "original_purchase_price" },
  { cell: "B28", key: "monthly_rent" },
  { cell: "B29", key: "annual_taxes" },
  { cell: "B30", key: "annual_insurance" },
  { cell: "B31", key: "annual_hoa" },
  { cell: "B32", key: "payoff_amount" },
  // Trade Information
  { cell: "E2", key: "investor_name" },
  { cell: "E3", key: "lock_date" },
  { cell: "E4", key: "lock_expiration_date" },
  { cell: "E5", key: "lock_price" },
  { cell: "E6", key: "servicer_name" },
  { cell: "E7", key: "servicing_number" },
  // Borrower Information
  { cell: "E10", key: "borrower_entity" },
  { cell: "E11", key: "entity_ein" },
  { cell: "E12", key: "guarantor_first_name" },
  { cell: "E13", key: "guarantor_last_name" },
  { cell: "E14", key: "guarantor_phone" },
  { cell: "E15", key: "guarantor_email" },
  { cell: "E16", key: "guarantor_fico" },
  { cell: "E17", key: "guarantor_first_name#2" },
  { cell: "E18", key: "guarantor_last_name#2" },
  { cell: "E19", key: "guarantor_phone#2" },
  { cell: "E20", key: "guarantor_email#2" },
  { cell: "E21", key: "guarantor_fico#2" },
  // Title / Insurance contacts
  { cell: "E24", key: "title_contact_name" },
  { cell: "E25", key: "title_contact_email" },
  { cell: "E26", key: "title_contact_phone" },
  { cell: "E29", key: "insurance_contact_name" },
  { cell: "E30", key: "insurance_contact_email" },
  { cell: "E31", key: "insurance_contact_phone" },
  // Closing Calculations — the input cells only (the rest are formulas)
  { cell: "H16", key: "underwriting_fee" },
  { cell: "H17", key: "legal_fee" },
  { cell: "H18", key: "prepaid_interest" },
  { cell: "J11", key: "closing_date" },
  { cell: "J12", key: "disbursement_date" },
  { cell: "J13", key: "first_payment_date" },
];

// Data Tape (row 2) — ONLY the columns Loan Data doesn't already feed by formula.
export const DATA_TAPE_CELLS: { cell: string; key: string }[] = [
  { cell: "C2", key: "channel" },
  { cell: "E2", key: "lien_position" },
  { cell: "W2", key: "cltv" },
  { cell: "Y2", key: "dti" },
  { cell: "AB2", key: "doc_type" },
  { cell: "AC2", key: "doc_type_detail" },
  { cell: "AK2", key: "fixed_period_months" },
  { cell: "AO2", key: "guarantor_citizenship" },
  { cell: "AP2", key: "foreign_national_flag" },
  { cell: "AQ2", key: "itin_flag" },
  { cell: "BG2", key: "mers_min" },
  { cell: "BH2", key: "uli" },
  { cell: "BI2", key: "day_count" },
];

/** Format a field value for USER_ENTERED entry, by field type. null => skip (don't clear). */
export function cellValue(type: string | undefined, raw: unknown): string | number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const str = String(raw);
  if (type === "percent") {
    const n = Number(str.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? `${n}%` : str; // "7.75%" -> Sheets stores 0.0775
  }
  if (type === "currency" || type === "number") {
    const n = Number(str.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : str;
  }
  return str; // text / select / date (YYYY-MM-DD parses under USER_ENTERED)
}

/**
 * Push a loan's field values into its DSCR dashboard (one-way: app → dashboard), across
 * the Loan Data and Data Tape tabs. Creates the per-deal dashboard from the template on
 * first sync (stored on loans.sheet_id) and writes only non-empty, non-formula cells, so
 * the dashboard's own formulas recompute from the inputs. Returns the sheet url + count.
 */
export async function syncLoanToDashboard(loanId: string): Promise<{ url: string; wrote: number }> {
  const admin = createServiceRoleClient();
  const { data: loan, error } = await admin
    .from("loans")
    .select("loan_number,opportunity_number,property_address,drive_folder_id,sheet_id,loan_type")
    .eq("id", loanId)
    .single();
  if (error) throw new Error(error.message);
  if (!loan) throw new Error("Loan not found.");
  if ((loan.loan_type ?? "").toUpperCase() !== "DSCR")
    throw new Error("Dashboard sync is DSCR-only for now (the only mapped template).");
  // Reuse the loan's existing "Open Loan Files" folder (matched by street) if the loan
  // isn't linked to one yet — so a script-created or externally-foldered loan can sync
  // without first creating a duplicate folder via a document upload.
  let driveFolderId = loan.drive_folder_id as string | null;
  if (!driveFolderId) {
    driveFolderId = await findDealFolderByStreet(propertyStreet(loan.property_address)).catch(() => null);
    if (driveFolderId) await admin.from("loans").update({ drive_folder_id: driveFolderId }).eq("id", loanId);
  }
  if (!driveFolderId)
    throw new Error("This deal has no Drive folder yet — upload a document to create it, then sync.");

  const ref = loan.loan_number ?? loan.opportunity_number ?? "";

  // Resolve (or create) the deal's dashboard sheet.
  let sheetId = loan.sheet_id as string | null;
  if (!sheetId) {
    const name = `Loan Dashboard - ${propertyStreet(loan.property_address)} - ${ref}`
      .replace(/\s+/g, " ")
      .trim();
    sheetId = await createDealDashboard(driveFolderId, name);
    await admin.from("loans").update({ sheet_id: sheetId }).eq("id", loanId);
  }

  const [fv, { data: defs }] = await Promise.all([
    loadFieldValues(admin, loanId),
    admin.from("field_definitions").select("key,type"),
  ]);
  const typeByKey = new Map((defs ?? []).map((d) => [d.key, d.type as string]));

  const cells: { range: string; value: string | number }[] = [];
  if (ref) cells.push({ range: "'Loan Data'!B2", value: String(ref) });
  // Write every mapped cell — the app's value, or blank to clear the template's sample
  // data for fields this loan hasn't filled (the app is the source of truth for the push).
  const add = (tab: string, map: { cell: string; key: string }[]) => {
    for (const { cell, key } of map) {
      const baseKey = key.includes("#") ? key.slice(0, key.indexOf("#")) : key;
      const out = cellValue(typeByKey.get(baseKey), fv[key]?.current);
      cells.push({ range: `'${tab}'!${cell}`, value: out ?? "" });
    }
  };
  add("Loan Data", LOAN_DATA_CELLS);
  add("Data Tape", DATA_TAPE_CELLS);

  await writeCells(sheetId, cells);
  return { url: sheetUrl(sheetId), wrote: cells.length };
}
