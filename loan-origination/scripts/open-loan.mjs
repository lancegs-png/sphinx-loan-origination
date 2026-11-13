#!/usr/bin/env node
/**
 * Open a new loan end-to-end, in one command:
 *   1. Creates the deal's Google Drive folder under "Open Loan Files" (Shared Drive),
 *      named "<address> [<Borrower>]", with the standard subfolders copied live from the
 *      Architecture Folder, plus a DSCR dashboard copied from the canonical Google Sheet
 *      template.
 *   2. Creates the app loan record via the deployed /api/admin/create-loan endpoint:
 *      a DSCR loan with the address + guarantor, the folder + dashboard linked, and
 *      (with --sphinx) the permanent SPHX number assigned now.
 *
 * All config comes from .env.local (the same file the app uses): GOOGLE_SERVICE_ACCOUNT_JSON,
 * GOOGLE_DRIVE_PARENT_FOLDER_ID, SHEETS_SYNC_SECRET. Optional overrides:
 * GOOGLE_ARCHITECTURE_FOLDER_ID, GOOGLE_DSCR_DASHBOARD_TEMPLATE_ID, APP_BASE_URL.
 *
 * Usage:
 *   node scripts/open-loan.mjs --address "123 Main St, City, ST 12345" --borrower "First Last" [--sphinx] [--dry-run] [--force]
 *
 * Flags:
 *   --address   (required) full property address
 *   --borrower  "First Last" guarantor; omit to open the folder address-only
 *   --sphinx    assign the permanent SPHX loan number now (default: OPP#### until signing)
 *   --dry-run   validate config + show the plan; create nothing
 *   --force     create even if a folder matching the street already exists
 */
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function parseArgs(argv) {
  const a = { sphinx: false, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--address") a.address = argv[++i];
    else if (v === "--borrower") a.borrower = argv[++i];
    else if (v === "--sphinx") a.sphinx = true;
    else if (v === "--dry-run") a.dryRun = true;
    else if (v === "--force") a.force = true;
  }
  return a;
}

const DEFAULTS = {
  ARCH: "1wdEKSdlGcSD_OmFCRNczyxI68lgI2sWn", // Architecture Folder (subfolder structure)
  DASH_TMPL: "1u20xar0tDxSsKt6C2PHfhQFUQqEiox4RATrNETrzTz4", // DSCR Deal Dashboard - Template (Google Sheet)
  APP_URL: "https://sphinx-loan-origination.vercel.app",
};
const SUBFOLDER_FALLBACK = [
  "Bank Statements", "Borrower Documents", "Conditions", "Entity Documents",
  "Insurance Documents", "Property Documents", "Title Documents",
];

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.address) die('Missing --address. Example: --address "123 Main St, City, ST 12345" --borrower "First Last"');

  const env = loadEnv(".env.local");
  const creds = env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) : null;
  const PARENT = env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  const ARCH = env.GOOGLE_ARCHITECTURE_FOLDER_ID || DEFAULTS.ARCH;
  const DASH_TMPL = env.GOOGLE_DSCR_DASHBOARD_TEMPLATE_ID || DEFAULTS.DASH_TMPL;
  const SECRET = env.SHEETS_SYNC_SECRET;
  const APP_URL = env.APP_BASE_URL || DEFAULTS.APP_URL;
  if (!creds) die("GOOGLE_SERVICE_ACCOUNT_JSON is not set in .env.local");
  if (!PARENT) die("GOOGLE_DRIVE_PARENT_FOLDER_ID is not set in .env.local");
  if (!SECRET && !args.dryRun) die("SHEETS_SYNC_SECRET is not set in .env.local (needed to call the app endpoint)");

  const [first = "", ...rest] = (args.borrower || "").trim().split(/\s+/).filter(Boolean).reverse();
  const guarantorLast = args.borrower ? first : "";          // last token = last name
  const guarantorFirst = rest.reverse().join(" ");           // the rest = first name(s)
  const bracket = args.borrower ? ` [${args.borrower.trim()}]` : "";
  const folderName = `${args.address}${bracket}`.replace(/\s+/g, " ").trim();
  const street = args.address.split(",")[0].trim();
  const dashName = `DSCR Deal Dashboard - ${street}`;

  const auth = new GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/drive"] });
  const tok = async () => (await (await auth.getClient()).getAccessToken()).token;
  const drive = async (url, init) => {
    const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await tok()}`, ...(init?.headers || {}) } });
    if (!r.ok) die(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  // Subfolders: live from the Architecture Folder (fallback to the known set).
  let subfolders = SUBFOLDER_FALLBACK;
  try {
    const q = `'${ARCH}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const j = await drive(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    if (j.files?.length) subfolders = j.files.map((f) => f.name).sort();
  } catch { /* keep fallback */ }

  // Duplicate guard (by street).
  const dupQ = `'${PARENT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name contains '${street.replace(/'/g, "\\'")}'`;
  const dup = await drive(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(dupQ)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (dup.files?.length && !args.force) {
    die(`A folder for "${street}" already exists (${dup.files[0].name}). Use --force to create anyway.`);
  }

  console.log(`Plan:\n  Folder:    ${folderName}\n  Subfolders: ${subfolders.join(", ")}\n  Dashboard: ${dashName}\n  Guarantor: ${args.borrower || "(none)"}\n  Number:    ${args.sphinx ? "assign SPHX now" : "OPP (SPHX at signing)"}`);
  if (args.dryRun) {
    console.log("\n(dry run — nothing created)");
    return;
  }

  // 1. Folder + subfolders + dashboard.
  const mkFolder = (name, parent) =>
    drive("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
    });
  const folder = await mkFolder(folderName, PARENT);
  await Promise.all(subfolders.map((s) => mkFolder(s, folder.id)));
  const dashboard = await drive(`https://www.googleapis.com/drive/v3/files/${DASH_TMPL}/copy?supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: dashName, parents: [folder.id], mimeType: "application/vnd.google-apps.spreadsheet" }),
  });

  // 2. App record via the deployed endpoint.
  const res = await fetch(`${APP_URL}/api/admin/create-loan`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: SECRET, address: args.address, guarantorFirst, guarantorLast,
      driveFolderId: folder.id, sheetId: dashboard.id, assignNumber: args.sphinx,
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) die(`create-loan endpoint ${res.status}: ${bodyText.slice(0, 300)}`);
  const out = JSON.parse(bodyText);

  console.log(`\n✓ Loan opened`);
  console.log(`  Number:    ${out.loan_number || out.opportunity_number}${out.loan_number ? ` (opp ${out.opportunity_number})` : ""}`);
  console.log(`  App:       ${APP_URL}/loans/${out.id}`);
  console.log(`  Folder:    ${folder.webViewLink}`);
  console.log(`  Dashboard: ${dashboard.webViewLink}`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
