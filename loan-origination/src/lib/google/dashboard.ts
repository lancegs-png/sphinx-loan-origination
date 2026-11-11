import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { propertyStreet } from "@/lib/documents/naming";
import { createDealDashboard } from "./drive";
import { writeCells, sheetUrl } from "./sheets";

/**
 * DSCR dashboard "Loan Data" tab — value cell ↔ field_key, from the bound cell map
 * (docs/google-sync/dscr-dashboard-cell-map.md). ONLY writable (↔ / →) cells are
 * listed; formula cells (B28 DSCR, E17–E21 monthly, Full Address) are intentionally
 * omitted so the dashboard's own formulas are never clobbered. Loan Number (B2) comes
 * from the loans row, not a field value. Repeat-group keys use the loadFieldValues form
 * (idx 1 bare, idx 2 as `key#2`).
 */
const LOAN_DATA_CELLS: { cell: string; key: string }[] = [
  { cell: "E2", key: "investor_name" },
  { cell: "B3", key: "application_date" },
  { cell: "B4", key: "product_type" },
  { cell: "E4", key: "lock_price" },
  { cell: "B5", key: "loan_amount" },
  { cell: "E5", key: "servicer_name" },
  { cell: "B6", key: "loan_purpose" },
  { cell: "E6", key: "servicing_number" },
  { cell: "B7", key: "interest_rate" },
  { cell: "B8", key: "prepay_term_months" },
  { cell: "B9", key: "prepay_type" },
  { cell: "B10", key: "ltv" },
  { cell: "B11", key: "origination_fee_pct" },
  { cell: "B12", key: "loan_term_months" },
  { cell: "B13", key: "as_is_value" },
  { cell: "B14", key: "io_months" },
  { cell: "B18", key: "property_street" },
  { cell: "B19", key: "property_city" },
  { cell: "B20", key: "property_state" },
  { cell: "B21", key: "property_zip" },
  { cell: "B22", key: "property_type" },
  { cell: "B23", key: "unit_count" },
  { cell: "B24", key: "monthly_rent" },
  { cell: "B25", key: "annual_taxes" },
  { cell: "B26", key: "annual_insurance" },
  { cell: "B27", key: "annual_hoa" },
  { cell: "B29", key: "payoff_amount" },
  { cell: "B32", key: "borrower_entity" },
  { cell: "B33", key: "entity_ein" },
  { cell: "B34", key: "guarantor_first_name" },
  { cell: "B35", key: "guarantor_last_name" },
  { cell: "B36", key: "guarantor_phone" },
  { cell: "B37", key: "guarantor_email" },
  { cell: "B38", key: "guarantor_fico" },
  { cell: "B39", key: "guarantor_first_name#2" },
  { cell: "B40", key: "guarantor_last_name#2" },
  { cell: "B41", key: "guarantor_phone#2" },
  { cell: "B42", key: "guarantor_email#2" },
  { cell: "B43", key: "guarantor_fico#2" },
  { cell: "E32", key: "title_contact_name" },
  { cell: "E33", key: "title_contact_email" },
  { cell: "E34", key: "title_contact_phone" },
  { cell: "E37", key: "insurance_contact_name" },
  { cell: "E38", key: "insurance_contact_email" },
  { cell: "E39", key: "insurance_contact_phone" },
];

/** Format a field value for USER_ENTERED entry, by field type. null => skip (don't clear). */
function cellValue(type: string | undefined, raw: unknown): string | number | null {
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
 * Push a loan's field values into its DSCR dashboard's Loan Data cells (one-way:
 * app → dashboard). Creates the per-deal dashboard from the template on first sync
 * (stored on loans.sheet_id) and writes only non-empty values, so the dashboard's own
 * formulas and any dashboard-only cells are left intact. Returns the sheet url + count.
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
  if (!loan.drive_folder_id)
    throw new Error("This deal has no Drive folder yet — upload a document to create it, then sync.");

  const ref = loan.loan_number ?? loan.opportunity_number ?? "";

  // Resolve (or create) the deal's dashboard sheet.
  let sheetId = loan.sheet_id as string | null;
  if (!sheetId) {
    const name = `Loan Dashboard - ${propertyStreet(loan.property_address)} - ${ref}`
      .replace(/\s+/g, " ")
      .trim();
    sheetId = await createDealDashboard(loan.drive_folder_id, name);
    await admin.from("loans").update({ sheet_id: sheetId }).eq("id", loanId);
  }

  const [fv, { data: defs }] = await Promise.all([
    loadFieldValues(admin, loanId),
    admin.from("field_definitions").select("key,type"),
  ]);
  const typeByKey = new Map((defs ?? []).map((d) => [d.key, d.type as string]));

  const cells: { range: string; value: string | number }[] = [];
  if (ref) cells.push({ range: "'Loan Data'!B2", value: String(ref) });
  for (const { cell, key } of LOAN_DATA_CELLS) {
    const baseKey = key.includes("#") ? key.slice(0, key.indexOf("#")) : key;
    const out = cellValue(typeByKey.get(baseKey), fv[key]?.current);
    if (out !== null) cells.push({ range: `'Loan Data'!${cell}`, value: out });
  }

  await writeCells(sheetId, cells);
  return { url: sheetUrl(sheetId), wrote: cells.length };
}
