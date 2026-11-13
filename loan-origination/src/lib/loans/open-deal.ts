import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertFieldValue } from "@/lib/fields";
import { recomputeLoan } from "@/lib/calc";
import { ensureProgramAndChecklist } from "@/lib/checklist-seed";
import { syncLoanToDashboard } from "@/lib/google/dashboard";
import { sheetsConfigured, appendSheetRow } from "@/lib/google/sheets";
import {
  driveConfigured,
  findDealFolderByStreet,
  findDashboardInFolder,
  createDealFolder,
  createDealSubfolders,
  createDealDashboard,
  renameDriveFile,
} from "@/lib/google/drive";
import { logEvent } from "@/lib/audit";

/** The org "Loan Number Tracker" sheet ([Address, Loan Number] rows). */
const LOAN_TRACKER_SHEET_ID =
  process.env.GOOGLE_LOAN_TRACKER_SHEET_ID || "1FLrQZqFAJ7v-8cZeT3EGTPJ_Vut6JLPp_rNSXwEbm4Y";

/** Split "123 Main St, City, ST 12345" into its parts (best-effort). */
export function parseAddress(a: string): { street: string; city: string; state: string; zip: string } {
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean);
  let state = "";
  let zip = "";
  const m = parts.slice(2).join(" ").match(/([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?/);
  if (m) {
    state = m[1].toUpperCase();
    zip = m[2];
  }
  return { street: parts[0] ?? "", city: parts[1] ?? "", state, zip };
}

export type OpenDealInput = {
  address: string;
  guarantorFirst?: string;
  guarantorLast?: string;
  /** Assign the permanent SPHX number now (and append the org tracker). */
  assignNumber?: boolean;
  /** An already-issued number (importing an existing loan): set directly, skip the sequence + tracker. */
  loanNumber?: string;
  /** Starting stage (default "intake"). A new loan goes straight to "processing". */
  stage?: string;
  /** Pre-made Drive assets (the open-loan script path); when absent the app creates them. */
  driveFolderId?: string | null;
  sheetId?: string | null;
  /** App path: the creating lender — sets created_by, adds them as a participant, greets. */
  createdByUserId?: string | null;
  accountManagerId?: string | null;
};

export type OpenDealResult = {
  id: string;
  opportunity_number: string | null;
  loan_number: string | null;
  address: string;
  drive_folder_id: string | null;
  sheet_id: string | null;
  dashboard: string | null;
  checklist_items: number;
};

/**
 * Open a new DSCR deal end-to-end: the Drive folder (+ subfolders + dashboard, created when
 * not supplied), the app loan record with the address + guarantor seeded, the OPP/SPHX
 * number, the org tracker row, the program document checklist, and the first dashboard sync.
 * Shared by the in-app "New loan" action and the ops /api/admin/create-loan endpoint so both
 * produce an identical deal. Caller supplies the service-role client.
 */
export async function openDeal(
  admin: SupabaseClient,
  input: OpenDealInput,
): Promise<OpenDealResult> {
  const address = input.address.trim();
  if (!address) throw new Error("Missing address");
  const guarantorFirst = (input.guarantorFirst ?? "").trim();
  const guarantorLast = (input.guarantorLast ?? "").trim();
  const borrower = [guarantorFirst, guarantorLast].filter(Boolean).join(" ").trim();
  const stage = input.stage ?? "intake";
  const assignNumber = input.assignNumber === true;
  const loanNumberIn = (input.loanNumber ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "");
  const { street, city, state, zip } = parseAddress(address);
  const folderLabel = [address, borrower ? `[${borrower}]` : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  // 1. Drive assets — create when not pre-provided and Drive is configured. Reuse an
  //    existing deal folder / dashboard (matched by street) so we never duplicate.
  let driveFolderId = input.driveFolderId ?? null;
  let sheetId = input.sheetId ?? null;
  let createdFolder = false;
  if (!driveFolderId && driveConfigured()) {
    try {
      const existing = await findDealFolderByStreet(street).catch(() => null);
      if (existing) {
        driveFolderId = existing;
      } else {
        driveFolderId = await createDealFolder(folderLabel);
        createdFolder = true;
        await createDealSubfolders(driveFolderId).catch(() => {});
      }
      sheetId =
        (await findDashboardInFolder(driveFolderId).catch(() => null)) ??
        (await createDealDashboard(driveFolderId, `DSCR Deal Dashboard - ${street}`).catch(() => null));
    } catch {
      /* fall back to app-only; the folder/dashboard can be linked later */
    }
  }

  // 2. Create the loan row (DSCR; the DB assigns the OPP#### opportunity number).
  const { data: loan, error } = await admin
    .from("loans")
    .insert({
      stage,
      loan_type: "DSCR",
      drive_folder_id: driveFolderId,
      sheet_id: sheetId,
      ...(input.createdByUserId ? { created_by: input.createdByUserId } : {}),
      ...(input.accountManagerId ? { account_manager_id: input.accountManagerId } : {}),
    })
    .select("id,opportunity_number")
    .single();
  if (error || !loan) throw new Error(error?.message ?? "loan insert failed");

  // 3. Seed the address + guarantor as field values (summary columns sync by trigger).
  const fields: [string, string][] = [
    ["property_address", address],
    ["property_street", street],
    ["property_city", city],
    ["property_state", state],
    ["property_zip", zip],
    ["loan_program", "DSCR"],
    ["guarantor_first_name", guarantorFirst],
    ["guarantor_last_name", guarantorLast],
  ];
  for (const [key, value] of fields) {
    if (value) await upsertFieldValue(admin, { loanId: loan.id, key, valueKind: "initial", value });
  }
  await recomputeLoan(loan.id).catch(() => {});

  // 4. Number: set an explicit existing number, or assign the next SPHX from the sequence.
  let loanNumber: string | null = null;
  if (loanNumberIn) {
    const { error: numErr } = await admin.from("loans").update({ loan_number: loanNumberIn }).eq("id", loan.id);
    if (numErr) throw new Error(`Set loan number failed: ${numErr.message}`);
    loanNumber = loanNumberIn;
  } else if (assignNumber) {
    const { data: n } = await admin.rpc("assign_loan_number", { p_loan_id: loan.id });
    loanNumber = (n as string | null) ?? null;
    if (loanNumber && sheetsConfigured()) {
      try {
        await appendSheetRow(LOAN_TRACKER_SHEET_ID, "Loan Number Tracker", [address, loanNumber]);
      } catch {
        /* ignore tracker failures — never block creation */
      }
    }
  }

  // 5. Program + document checklist (so the Documents tab is populated).
  let checklistItems = 0;
  try {
    checklistItems = (await ensureProgramAndChecklist(admin, loan.id)).checklistItems;
  } catch {
    /* best-effort: can be regenerated later */
  }

  // 6. Seed the linked dashboard with the loan's values (best-effort).
  let dashboard: string | null = null;
  try {
    dashboard = (await syncLoanToDashboard(loan.id)).url;
  } catch {
    /* best-effort: linked, will sync on the first field edit */
  }

  // 7. App path niceties: add the creator as a participant and prime the intake chat.
  if (input.createdByUserId) {
    const ref = loanNumber ?? loan.opportunity_number;
    const who = borrower ? ` for ${borrower}` : "";
    const kind = assignNumber ? "loan" : "opportunity";
    await admin
      .from("deal_participants")
      .insert({ loan_id: loan.id, user_id: input.createdByUserId, participant_role: "lending_team", added_by: input.createdByUserId })
      .then(() => {}, () => {});
    await admin
      .from("messages")
      .insert({
        loan_id: loan.id,
        sender_kind: "ai",
        sender_role: "ai",
        body: `This DSCR ${kind} (${ref ?? "new"}) is set up for ${address}${who}. Share the loan terms — rate, LTV, as-is value, monthly rent — or upload documents and I'll keep it moving.`,
      })
      .then(() => {}, () => {});
    await logEvent(admin, { loanId: loan.id, actorId: input.createdByUserId, eventType: "loan_created" });
  }

  // 8. Convention: folder name carries the number in front — "[<ref>] <address> [borrower]".
  //    Only rename a folder we created (never one reused from outside the app).
  const ref = loanNumber ?? loan.opportunity_number;
  if (createdFolder && driveFolderId && ref) {
    await renameDriveFile(driveFolderId, `[${ref}] ${folderLabel}`).catch(() => {});
  }

  return {
    id: loan.id,
    opportunity_number: loan.opportunity_number,
    loan_number: loanNumber,
    address,
    drive_folder_id: driveFolderId,
    sheet_id: sheetId,
    dashboard,
    checklist_items: checklistItems,
  };
}
