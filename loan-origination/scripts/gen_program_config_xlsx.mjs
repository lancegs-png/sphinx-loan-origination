// Generate the pre-filled "Sphinx Program Configuration" workbook (Loan Data / Documents /
// Tasks tabs) that Settings → Program configuration imports. Rows are seeded from the current
// field dictionary, the DSCR document set, and the DSCR stage tasks; the 7 program columns are
// pre-toggled to today's scope so the team can curate from a working baseline.
//
//   node scripts/gen_program_config_xlsx.mjs [output.xlsx]
//
// Column layout MUST match src/lib/program-config/contract.ts.
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

// The 7 canonical programs, in order (header + loan_type_key). Keep in sync with contract.ts.
const PROGRAMS = [
  ["Residential: Bridge", "bridge"],
  ["Residential: Fix & Flip", "fix_and_flip"],
  ["Residential: New Construction", "new_construction"],
  ["Residential: DSCR", "dscr"],
  ["Commercial: Bridge", "commercial_bridge"],
  ["Commercial: New Construction", "commercial_new_construction"],
  ["Commercial: Permanent", "commercial_permanent"],
];
const PROG_HEADERS = PROGRAMS.map(([h]) => h);
const RTL_KEYS = new Set(["bridge", "fix_and_flip", "new_construction"]);

const out = process.argv[2] || "program_config.xlsx";
const CHECK = true; // boolean cell → Google Sheets / importer read it as "on"

// A row's program cells, given the set of checked program keys.
const progCells = (keys) => PROGRAMS.map(([, k]) => (keys.has(k) ? CHECK : null));

const wb = new ExcelJS.Workbook();
wb.creator = "Sphinx";
wb.created = new Date();

function addTab(name, headers, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 0, ySplit: 1 }] });
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  // Reasonable widths: wide for the first text columns, narrow for the program toggles.
  ws.columns.forEach((col, i) => {
    col.width = i < headers.length - PROG_HEADERS.length ? 22 : 14;
  });
}

// ---------- Loan Data ----------
const fields = JSON.parse(readFileSync(new URL("./out/field_definitions.json", import.meta.url)));
const LD_HEAD = ["Key", "Reference", "Label", "Section", "Type", "Options", "Source", "Stage", "Repeat", "Lender only", ...PROG_HEADERS];
const ldRows = fields.map((f) => {
  const progs = (f.programs || []).map((p) => String(p).toLowerCase());
  let keys;
  if (progs.length === 0) keys = new Set(PROGRAMS.map(([, k]) => k)); // applies to all
  else {
    keys = new Set();
    if (progs.includes("dscr")) keys.add("dscr");
    if (progs.includes("rtl")) RTL_KEYS.forEach((k) => keys.add(k));
    // any explicit canonical key passes through
    for (const [, k] of PROGRAMS) if (progs.includes(k)) keys.add(k);
  }
  return [
    f.key,
    `{{${f.key}}}`,
    f.label || f.key,
    f.section || "loan",
    f.type || "text",
    Array.isArray(f.options) ? f.options.join(", ") : "",
    f.source || "",
    f.required_stage || "",
    f.repeat_group || "",
    f.lender_only ? CHECK : null,
    ...progCells(keys),
  ];
});
addTab("Loan Data", LD_HEAD, ldRows);

// ---------- Documents (current DSCR document set) ----------
const B = "Borrower documents", L = "Lender documents";
const borrower = "borrower", lender = "lending_team";
const DOCS = [
  ["Loan Application", B, borrower, "Fully completed, signed", true],
  ["Borrower IDs", B, borrower, "Driver license or passport, clear and legible, matches name on application", true],
  ["Articles of Organization", B, borrower, "Matches name on other entity docs", true],
  ["Operating Agreement or Bylaws", B, borrower, "All pages; lists all owners and ownership %", true],
  ["EIN Letter or W9 Form", B, borrower, "Entity name matches other entity documents", true],
  ["Track Record / REO", B, borrower, "", true],
  ["Lease Agreements", B, borrower, "All pages, executed, current; list start and expiration", true],
  ["Rental Ledgers / Proof of Rent", B, borrower, "", true],
  ["Proof of Deposits into Bank Account", B, borrower, "", true],
  ["Voided Check for ACH", B, borrower, "", true],
  ["Original Settlement Statement", B, borrower, "If refinance. Entity on title matches borrower", false],
  ["Two Months' Bank Statements", B, borrower, "", true],
  ["Payoff", B, borrower, "If refinance", false],
  ["VOM Primary and Subject", B, borrower, "Needed if late fees or default interest on payoff", false],
  ["Purchase Contract", B, borrower, "If purchase. Signed, all addendums (from LOI Exhibit B)", false],
  ["Scope of Work", B, borrower, "If recently renovated (from LOI Exhibit B)", false],
  ["Appraisal", L, lender, "As-is and market rent summary; correct occupancy and lender name", true],
  ["CDA", L, lender, "Order from Clear Capital", true],
  ["Flood Cert", L, lender, "floodcert.com", true],
  ["Evidence of Insurance", L, lender, "", true],
  ["Credit Report", L, lender, "Late payments need LOE; score above 660 or add guarantors", true],
  ["Certificate of Good Standing", L, lender, "Shows date; entity current", true],
  ["Signed Term Sheet", L, lender, "One per property", true],
  ["OFAC Search Results", L, lender, "", true],
  ["Prelim Title", L, lender, "Correct mortgagee", true],
  ["Condo Questionnaire", L, lender, "If HOA", false],
  ["Condo Master Policy", L, lender, "If HOA", false],
  ["Background Check (Personal/Business)", L, lender, "", true],
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const DOC_HEAD = ["Key", "Name", "Type", "Access", "Guidance", "Required", ...PROG_HEADERS];
const docRows = DOCS.map(([name, category, , guidance, required]) => [
  slug(name),
  name,
  category,
  "All", // Access / visibility: All (Lender + Borrower + Broker) or Lender Only
  guidance,
  required ? CHECK : null,
  ...progCells(new Set(["dscr"])), // seeded scope: current DSCR checklist
]);
addTab("Documents", DOC_HEAD, docRows);

// ---------- Tasks (current DSCR stage tasks) ----------
const TASKS = [
  ["opportunity", "Collect borrower & entity details"],
  ["opportunity", "Confirm property address, type & units"],
  ["opportunity", "Confirm loan purpose & requested amount"],
  ["opportunity", "Preliminary DSCR / rent check"],
  ["quoted", "Send term sheet / LOI"],
  ["quoted", "Confirm pricing tier & rate lock"],
  ["quoted", "Borrower signs term sheet"],
  ["processing", "Order appraisal"],
  ["processing", "Collect bank statements"],
  ["processing", "Collect entity documents"],
  ["processing", "Order title"],
  ["processing", "Verify insurance"],
  ["processing", "Collect lease / rent roll"],
  ["underwriting", "Submit file to investor"],
  ["underwriting", "Appraisal review"],
  ["underwriting", "Final DSCR calculation"],
  ["underwriting", "Clear underwriting conditions"],
  ["closing", "Prepare closing package"],
  ["closing", "Confirm wire / escrow instructions"],
  ["closing", "Schedule signing"],
  ["closing", "Collect executed closing documents"],
  ["closed", "Ship collateral"],
  ["closed", "Record funding"],
  ["closed", "Investor purchase confirmation"],
  ["closed", "File loan documents"],
];
const TASK_HEAD = ["Stage bucket", "Label", "Visibility", "Assigned To", ...PROG_HEADERS];
// Tasks default to internal: Lender Only visibility, assigned to Lender. Open specific tasks
// to the borrower/broker by setting Visibility = All.
const taskRows = TASKS.map(([bucket, label]) => [
  bucket,
  label,
  "Lender Only",
  "Lender",
  ...progCells(new Set(["dscr"])),
]);
addTab("Tasks", TASK_HEAD, taskRows);

await wb.xlsx.writeFile(out);
console.log(`Wrote ${out}: Loan Data ${ldRows.length}, Documents ${docRows.length}, Tasks ${taskRows.length} rows.`);
