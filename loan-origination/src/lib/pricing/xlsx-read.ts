import "server-only";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

/** A1-addressed cell map for one worksheet: { "C9": 0.095, "H11": "780+", ... }. */
export type CellMap = Record<string, string | number | null>;

/**
 * Stream a workbook and capture only the named worksheets as A1 cell maps. Streaming keeps
 * memory flat even when the file carries a huge data tab (the Eastview sizer has a 26k-row
 * Zillow sheet) — unwanted sheets are read past and discarded. Formula cells yield their last
 * cached result (the sizer's own computed value), matching an Excel "paste values" read.
 */
export async function readSheets(buffer: Buffer, names: string[]): Promise<Record<string, CellMap>> {
  const want = new Set(names);
  const out: Record<string, CellMap> = {};
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
  });
  for await (const ws of reader) {
    const name = (ws as unknown as { name: string }).name;
    if (!want.has(name)) {
      // Still drain the row stream so the reader advances to the next sheet.
      for await (const _row of ws) void _row;
      continue;
    }
    const cells: CellMap = (out[name] = {});
    for await (const row of ws) {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells[cell.address] = cellValue(cell.value);
      });
    }
  }
  return out;
}

function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellValue(o.result as ExcelJS.CellValue); // formula → cached result
    if ("text" in o) return String(o.text); // rich text / hyperlink
    if ("richText" in o && Array.isArray(o.richText))
      return (o.richText as { text: string }[]).map((r) => r.text).join("");
  }
  return null;
}

/** Column letter (A, B, …, AA) for a 1-based column index. */
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Read a cell by 1-based row/col from a CellMap. */
export function at(cells: CellMap, row: number, col: number): string | number | null {
  return cells[`${colLetter(col)}${row}`] ?? null;
}

/** Coerce a cell to a number, or null for blank / "N/A" / non-numeric. */
export function toNum(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s.toUpperCase() === "N/A") return null;
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Trimmed string, or "" for blank. */
export function toStr(v: string | number | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Normalize a cell to an ISO date (YYYY-MM-DD). Streaming reads skip styles, so date cells come
 * back as Excel serial numbers; convert those (serial 1 = 1900-01-01, via the 1899-12-30 epoch).
 * ISO strings are sliced; anything else yields null.
 */
export function toDateISO(v: string | number | null | undefined): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400 * 1000); // 25569 = days from 1899-12-30 to 1970-01-01
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = toStr(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
