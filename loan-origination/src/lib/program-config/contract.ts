// The import contract for the Program Configuration spreadsheet (Settings → Program config).
// One source of truth for the three tabs, their columns, and the 7 program columns — used
// by both the parser (src/lib/program-config/parse.ts) and the Google Sheet generator so the
// Sheet the team edits and the importer that reads it can never drift apart.

export type AssetClass = "residential" | "commercial";

export type ProgramColumn = { header: string; key: string; assetClass: AssetClass };

/** The 7 canonical programs, in display order. `key` is the loan_programs.loan_type_key. */
export const PROGRAM_COLUMNS: ProgramColumn[] = [
  { header: "Residential: Bridge", key: "bridge", assetClass: "residential" },
  { header: "Residential: Fix & Flip", key: "fix_and_flip", assetClass: "residential" },
  { header: "Residential: New Construction", key: "new_construction", assetClass: "residential" },
  { header: "Residential: DSCR", key: "dscr", assetClass: "residential" },
  { header: "Commercial: Bridge", key: "commercial_bridge", assetClass: "commercial" },
  { header: "Commercial: New Construction", key: "commercial_new_construction", assetClass: "commercial" },
  { header: "Commercial: Permanent", key: "commercial_permanent", assetClass: "commercial" },
];

export const PROGRAM_KEYS: string[] = PROGRAM_COLUMNS.map((c) => c.key);

export const LOAN_DATA_TAB = "Loan Data";
export const DOCUMENTS_TAB = "Documents";
export const TASKS_TAB = "Tasks";

export const STAGE_BUCKETS_ORDER = [
  "opportunity",
  "quoted",
  "processing",
  "underwriting",
  "closing",
  "closed",
] as const;

// Leading (non-program) columns of each tab, in order. The 7 program columns follow.
export const LOAN_DATA_LEAD = [
  "Key",
  "Reference",
  "Label",
  "Section",
  "Type",
  "Options",
  "Source",
  "Stage",
  "Repeat",
  "Lender only",
];
export const DOCUMENTS_LEAD = ["Key", "Name", "Type", "Access", "Guidance", "Required"];
export const TASKS_LEAD = ["Stage bucket", "Label", "Visibility", "Assigned To"];

export const LOAN_DATA_HEADERS = [...LOAN_DATA_LEAD, ...PROGRAM_COLUMNS.map((c) => c.header)];
export const DOCUMENTS_HEADERS = [...DOCUMENTS_LEAD, ...PROGRAM_COLUMNS.map((c) => c.header)];
export const TASKS_HEADERS = [...TASKS_LEAD, ...PROGRAM_COLUMNS.map((c) => c.header)];

/** A program-column cell counts as "on" for these values (case-insensitive). */
export function isChecked(v: string | number | null | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "x" || s === "y" || s === "yes" || s === "✓" || s === "✔" || s === "✅";
}

/** The `{{key}}` reference an author pastes into a template. */
export function bracketRef(key: string): string {
  return `{{${key}}}`;
}
