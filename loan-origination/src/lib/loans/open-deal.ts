import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertFieldValue, writeIntakeFields } from "@/lib/fields";
import { deriveProgram } from "@/lib/intake/form-spec";
import { copyPartiesToLoan } from "@/lib/parties";
import { recomputeLoan } from "@/lib/calc";
import { ensureProgramAndChecklist } from "@/lib/checklist-seed";
import { syncLoanToDashboard } from "@/lib/google/dashboard";
import { sheetsConfigured, appendSheetRow, LOAN_TRACKER_SHEET_ID } from "@/lib/google/sheets";
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

/**
 * Split a free-text US address into its parts (best-effort). Handles the common shapes:
 *   "123 Main St, City, ST 12345"   (standard)
 *   "123 Main St, City ST 12345"    (comma only after the street)
 *   "123 Main St City, ST 12345"    (comma before the state)
 *   "123 Main St, City, ST"         (no ZIP)
 * The trailing "ST ZIP" / "ZIP" is always pulled off the end first, so State and Zip can
 * never land in City; the remainder is then split on commas into street + city. When the
 * street and city are run together with no comma between them they can't be told apart, so
 * the city text stays with the street rather than being guessed — the full address still
 * reads correctly and City can be filled in by hand.
 */
export function parseAddress(a: string): { street: string; city: string; state: string; zip: string } {
  const s = a.trim();
  let state = "";
  let zip = "";
  let rest = s;
  // 1. Pull the trailing "ST 12345" (ZIP may be 4 digits for leading-zero NE ZIPs, +4 optional),
  //    separated from the rest by a comma or space.
  const stateZip = s.match(/^(.*?)[,\s]+([A-Za-z]{2})\s+(\d{4,5})(?:-\d{4})?\s*$/);
  if (stateZip) {
    rest = stateZip[1];
    state = stateZip[2].toUpperCase();
    zip = stateZip[3];
  } else {
    // ...or a bare trailing 5-digit ZIP with no state.
    const zipOnly = s.match(/^(.*?)[,\s]+(\d{5})(?:-\d{4})?\s*$/);
    if (zipOnly) {
      rest = zipOnly[1];
      zip = zipOnly[2];
    }
  }
  // 2. Split what's left on commas: street first, city is everything after it.
  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  // A bare 2-letter trailing group is the state (a ZIP-less "..., City, TX").
  if (!state && parts.length >= 2 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) {
    state = parts.pop()!.toUpperCase();
  }
  return { street: parts[0] ?? "", city: parts.slice(1).join(", "), state, zip };
}

export type OpenDealInput = {
  address: string;
  guarantorFirst?: string;
  guarantorLast?: string;
  /** Saved guarantors/entity (the library) to snapshot onto the new loan. */
  guarantorIds?: string[];
  entityId?: string | null;
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
  /** Full intake-form submission: stored as an immutable snapshot and seeded as field values. */
  intake?: Record<string, unknown> | null;
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

  // 2. Create the loan row (the DB assigns the OPP#### opportunity number). When an intake
  //    submission is supplied, derive the program from it (§5.1) and resolve its program_id
  //    so the right checklist seeds; the exact payload is also frozen on custom_fields as the
  //    read-only Intake Form Data snapshot. Without intake, default to DSCR as before.
  const intake = input.intake ?? null;
  const derived = intake ? deriveProgram(intake) : null;
  let programId: string | null = null;
  if (derived) {
    const { data: prog } = await admin
      .from("loan_programs")
      .select("id")
      .eq("loan_type_key", derived.key)
      .maybeSingle();
    programId = (prog?.id as string | undefined) ?? null;
  }
  const { data: loan, error } = await admin
    .from("loans")
    .insert({
      stage,
      loan_type: derived?.label ?? "DSCR",
      ...(programId ? { program_id: programId } : {}),
      ...(intake
        ? {
            custom_fields: {
              intake_snapshot: {
                submitted_at: new Date().toISOString(),
                source: "intake_form",
                values: intake,
              },
            },
          }
        : {}),
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
    ["loan_program", derived?.loanProgram ?? "DSCR"],
    ["guarantor_first_name", guarantorFirst],
    ["guarantor_last_name", guarantorLast],
  ];
  for (const [key, value] of fields) {
    if (value) await upsertFieldValue(admin, { loanId: loan.id, key, valueKind: "initial", value });
  }
  // Seed the full intake submission as initial field values. Known dictionary keys only —
  // any new keys not yet imported into field_definitions are skipped here but preserved in
  // the snapshot, and seed on the next Program Config re-import.
  if (intake) {
    const { data: defRows } = await admin.from("field_definitions").select("key,type,source");
    const defs = Object.fromEntries(
      (defRows ?? []).map((d) => [
        d.key as string,
        { type: String(d.type), source: (d.source as string | null) ?? null },
      ]),
    );
    await writeIntakeFields(admin, loan.id, intake, defs).catch(() => {});
  }
  // Snapshot any selected library guarantors/entity onto the loan (overwrites the bare
  // guarantor name seeded above with the full saved records).
  if ((input.guarantorIds?.length ?? 0) > 0 || input.entityId) {
    await copyPartiesToLoan(admin, loan.id, input.guarantorIds ?? [], input.entityId ?? null).catch(() => {});
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
