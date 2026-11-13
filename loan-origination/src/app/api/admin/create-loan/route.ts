import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { upsertFieldValue } from "@/lib/fields";
import { recomputeLoan } from "@/lib/calc";
import { ensureProgramAndChecklist } from "@/lib/checklist-seed";
import { syncLoanToDashboard } from "@/lib/google/dashboard";
import { sheetsConfigured, appendSheetRow } from "@/lib/google/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The org "Loan Number Tracker" sheet (see src/app/actions.ts / signTermSheet).
const LOAN_TRACKER_SHEET_ID =
  process.env.GOOGLE_LOAN_TRACKER_SHEET_ID || "1FLrQZqFAJ7v-8cZeT3EGTPJ_Vut6JLPp_rNSXwEbm4Y";

/**
 * Ops-only: open a new loan in the app (the record addLoan creates, minus the chat intake
 * session) with a property address, optional guarantor, and the deal's Drive folder + DSCR
 * dashboard linked. Optionally assigns the permanent SPHX number right away. Service role,
 * gated solely by SHEETS_SYNC_SECRET — same trust model as the other /api/admin routes.
 */
function secretOk(given: string): boolean {
  const expected = process.env.SHEETS_SYNC_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Split "123 Main St, City, ST 12345" into its parts (best-effort). */
function parseAddress(a: string): { street: string; city: string; state: string; zip: string } {
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

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const address = String(body.address ?? "").trim();
  if (!address) return new Response("Missing address", { status: 400 });
  const guarantorFirst = String(body.guarantorFirst ?? "").trim();
  const guarantorLast = String(body.guarantorLast ?? "").trim();
  const driveFolderId = String(body.driveFolderId ?? "").trim() || null;
  const sheetId = String(body.sheetId ?? "").trim() || null;
  const assignNumber = body.assignNumber === true;

  const admin = createServiceRoleClient();

  // 1. Create the loan row (DSCR; the DB assigns an OPP#### opportunity number).
  const { data: loan, error } = await admin
    .from("loans")
    .insert({ stage: "intake", loan_type: "DSCR", drive_folder_id: driveFolderId, sheet_id: sheetId })
    .select("id,opportunity_number")
    .single();
  if (error || !loan) return new Response(error?.message ?? "insert failed", { status: 500 });

  // 2. Seed the address + guarantor as field values (summary columns sync by trigger).
  const { street, city, state, zip } = parseAddress(address);
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

  // 3. Assign the permanent SPHX number now, if requested (idempotent in the DB function).
  let loanNumber: string | null = null;
  if (assignNumber) {
    const { data: n } = await admin.rpc("assign_loan_number", { p_loan_id: loan.id });
    loanNumber = (n as string | null) ?? null;
    // Add the deal to the org Loan Tracker when it gets its SPHX number (matches
    // signTermSheet / promote-loan). Best-effort — never fail creation on a tracker write.
    if (loanNumber && sheetsConfigured()) {
      try {
        await appendSheetRow(LOAN_TRACKER_SHEET_ID, "Loan Number Tracker", [address, loanNumber]);
      } catch {
        /* ignore tracker failures */
      }
    }
  }

  // 4. Set the program and build the document checklist (so the Documents tab is populated).
  let checklistItems = 0;
  try {
    checklistItems = (await ensureProgramAndChecklist(admin, loan.id)).checklistItems;
  } catch {
    /* best-effort: the program/checklist can be regenerated later */
  }

  // 5. Seed the linked dashboard with the loan's values (best-effort).
  let dashboard: string | null = null;
  try {
    dashboard = (await syncLoanToDashboard(loan.id)).url;
  } catch {
    /* best-effort: the dashboard is linked and will sync on the first field edit */
  }

  return Response.json({
    ok: true,
    id: loan.id,
    opportunity_number: loan.opportunity_number,
    loan_number: loanNumber,
    address,
    drive_folder_id: driveFolderId,
    sheet_id: sheetId,
    dashboard,
    checklist_items: checklistItems,
  });
}
