import "server-only";
import ExcelJS from "exceljs";
import {
  PROGRAM_COLUMNS,
  PROGRAM_KEYS,
  LOAN_DATA_TAB,
  DOCUMENTS_TAB,
  TASKS_TAB,
  STAGE_BUCKETS_ORDER,
  isChecked,
} from "./contract";

export type ParsedField = {
  key: string;
  label: string;
  section: string;
  type: string;
  options: string[];
  source: string | null;
  requiredStage: string | null;
  repeatGroup: string | null;
  lenderOnly: boolean;
  programs: string[]; // checked program keys ([] when none; "all 7" is normalized by the importer)
  allPrograms: boolean; // every program column checked → applies to all
};

export type ParsedDocument = {
  key: string;
  name: string;
  category: string | null;
  assignee: string;
  visibility: string; // all | lender_only
  guidance: string | null;
  required: boolean;
  programs: string[];
};

export type ParsedTask = {
  stageBucket: string;
  label: string;
  visibility: string; // all | lender_only
  assignedTo: string | null; // lender | borrower | broker | null
  programs: string[];
};

/** Normalize an Access/Visibility cell to 'all' | 'lender_only'. A blank cell takes `dflt`
 *  (documents default to shared, tasks default to lender-only). Anything that names the
 *  lending team — "lender", "lender only", "lending_team", "lending team" — is lender-only;
 *  "both", "all", "shared" and the like are visible to everyone. Matching on the "lend" stem
 *  is deliberate so "lending_team" (which does not contain the exact word "lender") maps right. */
function parseVisibility(v: string, dflt: string): string {
  const s = v.trim().toLowerCase();
  if (!s) return dflt;
  if (s.includes("lend")) return "lender_only";
  return "all";
}

/** Normalize an "Assigned To" cell to lender | borrower | broker | null. */
function parseAssignedTo(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (s === "lender" || s === "lending_team" || s === "lending team") return "lender";
  if (s === "borrower") return "borrower";
  if (s === "broker" || s === "originator") return "broker";
  return null;
}

// Friendly aliases for stage-bucket names, so common wordings the team types in the sheet
// (e.g. "Post-Close" for the Closed bucket) import instead of being skipped.
const BUCKET_ALIASES: Record<string, string> = {
  "post-close": "closed",
  "post_close": "closed",
  "post close": "closed",
  "postclose": "closed",
  "post-closing": "closed",
  "post closing": "closed",
};
function normalizeBucket(v: string): string {
  const s = v.toLowerCase().trim();
  return BUCKET_ALIASES[s] ?? s;
}

export type ParsedConfig = {
  fields: ParsedField[];
  documents: ParsedDocument[];
  tasks: ParsedTask[];
  warnings: string[];
};

/** Flatten any ExcelJS cell value (string, number, boolean, date, formula, rich text) to text. */
function cellToStr(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellToStr(o.result as ExcelJS.CellValue);
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((r) => r.text).join("").trim();
    }
    if ("text" in o) return String(o.text).trim();
  }
  return "";
}

/** Map header text (row 1, lowercased) → 1-based column index. */
function headerMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const h = cellToStr(cell.value).toLowerCase();
    if (h) map.set(h, col);
  });
  return map;
}

function val(ws: ExcelJS.Worksheet, row: number, header: Map<string, number>, name: string): string {
  const col = header.get(name.toLowerCase());
  return col ? cellToStr(ws.getRow(row).getCell(col).value) : "";
}

/** Which program keys are checked on this row (by the 7 program column headers). */
function checkedPrograms(ws: ExcelJS.Worksheet, row: number, header: Map<string, number>): string[] {
  const keys: string[] = [];
  for (const col of PROGRAM_COLUMNS) {
    const c = header.get(col.header.toLowerCase());
    if (c && isChecked(cellToStr(ws.getRow(row).getCell(c).value))) keys.push(col.key);
  }
  return keys;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Parse an exported Program Configuration workbook (.xlsx) into typed field / document / task
 * rows plus the per-program toggles. Pure: it reads the file and reports structure problems as
 * warnings; it does not touch the database. Uses ExcelJS's standard loader (the file is small),
 * which handles both Excel- and Google-Sheets-exported workbooks.
 */
export async function parseProgramConfig(buffer: Buffer): Promise<ParsedConfig> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's type wants an ArrayBuffer; a Node Buffer works at runtime.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const warnings: string[] = [];

  // ---- Loan Data ----
  const fields: ParsedField[] = [];
  const ld = wb.getWorksheet(LOAN_DATA_TAB);
  if (!ld) {
    warnings.push(`Missing "${LOAN_DATA_TAB}" tab — no fields imported.`);
  } else {
    const header = headerMap(ld);
    if (!header.has("key")) warnings.push(`"${LOAN_DATA_TAB}" tab has no "Key" column.`);
    const seen = new Set<string>();
    for (let r = 2; r <= ld.rowCount; r++) {
      const key = val(ld, r, header, "Key").trim();
      if (!key) continue;
      if (seen.has(key)) warnings.push(`Duplicate field key "${key}" on ${LOAN_DATA_TAB} row ${r} — last one wins.`);
      seen.add(key);
      const programs = checkedPrograms(ld, r, header);
      const optionsRaw = val(ld, r, header, "Options");
      fields.push({
        key,
        label: val(ld, r, header, "Label") || key,
        section: (val(ld, r, header, "Section") || "loan").toLowerCase(),
        type: (val(ld, r, header, "Type") || "text").toLowerCase(),
        options: optionsRaw ? optionsRaw.split(",").map((o) => o.trim()).filter(Boolean) : [],
        source: val(ld, r, header, "Source").toLowerCase() || null,
        requiredStage: val(ld, r, header, "Stage") || null,
        repeatGroup: val(ld, r, header, "Repeat") || null,
        lenderOnly: isChecked(val(ld, r, header, "Lender only")),
        programs,
        allPrograms: programs.length === PROGRAM_KEYS.length,
      });
    }
  }

  // ---- Documents ----
  const documents: ParsedDocument[] = [];
  const dt = wb.getWorksheet(DOCUMENTS_TAB);
  if (!dt) {
    warnings.push(`Missing "${DOCUMENTS_TAB}" tab — no documents imported.`);
  } else {
    const header = headerMap(dt);
    const seen = new Set<string>();
    for (let r = 2; r <= dt.rowCount; r++) {
      const name = val(dt, r, header, "Name").trim();
      let key = val(dt, r, header, "Key").trim();
      if (!name && !key) continue;
      if (!key) key = slug(name);
      if (seen.has(key)) warnings.push(`Duplicate document key "${key}" on ${DOCUMENTS_TAB} row ${r}.`);
      seen.add(key);
      const assignee = val(dt, r, header, "Assignee").toLowerCase();
      documents.push({
        key,
        name: name || key,
        // "Type" is the grouping column; accept the legacy "Category" header too.
        category: val(dt, r, header, "Type") || val(dt, r, header, "Category") || null,
        assignee: assignee === "lending_team" || assignee === "lender" ? "lending_team" : "borrower",
        // "Access" is the visibility column; accept "Visibility" too. Documents default to shared.
        visibility: parseVisibility(val(dt, r, header, "Access") || val(dt, r, header, "Visibility"), "all"),
        guidance: val(dt, r, header, "Guidance") || null,
        required: isChecked(val(dt, r, header, "Required")),
        programs: checkedPrograms(dt, r, header),
      });
    }
  }

  // ---- Tasks ----
  const tasks: ParsedTask[] = [];
  const tk = wb.getWorksheet(TASKS_TAB);
  if (!tk) {
    warnings.push(`Missing "${TASKS_TAB}" tab — no tasks imported.`);
  } else {
    const header = headerMap(tk);
    const valid = new Set<string>(STAGE_BUCKETS_ORDER);
    for (let r = 2; r <= tk.rowCount; r++) {
      const label = val(tk, r, header, "Label").trim();
      if (!label) continue;
      const bucket = normalizeBucket(val(tk, r, header, "Stage bucket"));
      if (!valid.has(bucket)) {
        warnings.push(`Task "${label}" on ${TASKS_TAB} row ${r} has an unknown stage bucket "${bucket}" — skipped.`);
        continue;
      }
      tasks.push({
        stageBucket: bucket,
        label,
        visibility: parseVisibility(val(tk, r, header, "Visibility") || val(tk, r, header, "Access"), "lender_only"),
        assignedTo: parseAssignedTo(val(tk, r, header, "Assigned To") || val(tk, r, header, "Assigned")),
        programs: checkedPrograms(tk, r, header),
      });
    }
  }

  return { fields, documents, tasks, warnings };
}
