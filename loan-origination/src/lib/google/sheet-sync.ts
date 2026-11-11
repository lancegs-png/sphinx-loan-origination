import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues, upsertFieldValue, coerceForType } from "@/lib/fields";
import { recomputeLoan } from "@/lib/calc";
import { logEvent } from "@/lib/audit";
import { writeCells } from "./sheets";
import { LOAN_DATA_CELLS, DATA_TAPE_CELLS, cellValue } from "./dashboard";

/**
 * Live two-way bridge between a loan's field values and its "Loan Dashboard" Google Sheet.
 * - Outbound (app -> sheet): pushFieldsToSheet writes just the changed input cells; the
 *   sheet's own formulas recompute the derived cells. Called after every app-side save.
 *   (Sheets API writes do NOT fire the sheet's onEdit trigger, so this never loops back.)
 * - Inbound (sheet -> app): applySheetEdit takes one human cell edit (delivered by the
 *   sheet's Apps Script onEdit via /api/sheets/edit) and writes it to the field model with
 *   last-writer-wins, ignoring blanks and anything that isn't a user-editable input cell.
 *   It never pushes back, so the editor's cell is left untouched.
 */

type Loc = { tab: "Loan Data" | "Data Tape"; cell: string };
const splitKey = (k: string): { base: string; idx: number } =>
  k.includes("#") ? { base: k.slice(0, k.indexOf("#")), idx: Number(k.slice(k.indexOf("#") + 1)) || 1 } : { base: k, idx: 1 };

// "<tab>!<cell>" -> loadFieldValues-form key (e.g. "guarantor_first_name#2"). Input cells
// only (the dashboard maps already omit formula/derived cells), so sheet formula edits map
// to nothing and are ignored.
const CELL_TO_FIELD = new Map<string, string>();
// loadFieldValues-form key -> its single input cell, for the outbound push.
const FIELD_TO_CELL = new Map<string, Loc>();
for (const [tab, map] of [["Loan Data", LOAN_DATA_CELLS], ["Data Tape", DATA_TAPE_CELLS]] as const) {
  for (const { cell, key } of map) {
    CELL_TO_FIELD.set(`${tab}!${cell}`, key);
    FIELD_TO_CELL.set(key, { tab, cell });
  }
}

/** Parse a sheet display date ("9/1/2026" or "2026-09-01") to ISO YYYY-MM-DD, or null. */
function toIsoDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export type SheetEdit = { sheetId: string; tab: string; cell: string; value: string; editedAt: string };
export type SheetEditResult = { status: "applied" | "ignored" | "skipped"; reason?: string; key?: string };

/** Apply one human sheet edit to the field model (service-role; last-writer-wins). */
export async function applySheetEdit(edit: SheetEdit): Promise<SheetEditResult> {
  const fieldKey = CELL_TO_FIELD.get(`${edit.tab}!${edit.cell}`);
  if (!fieldKey) return { status: "ignored", reason: "unmapped cell" };
  if (edit.value == null || edit.value.trim() === "") return { status: "ignored", reason: "blank (ignored)" };

  const admin = createServiceRoleClient();
  const { base: key, idx } = splitKey(fieldKey);

  const { data: loan } = await admin.from("loans").select("id").eq("sheet_id", edit.sheetId).maybeSingle();
  if (!loan) return { status: "ignored", reason: "no loan linked to this sheet" };
  const loanId = loan.id as string;

  const { data: def } = await admin
    .from("field_definitions")
    .select("type,source,options")
    .eq("key", key)
    .maybeSingle();
  if (!def) return { status: "ignored", reason: "unknown field" };
  if (def.source === "calculated" || def.source === "system") return { status: "ignored", reason: "read-only field" };

  const type = def.type as string;
  let value: unknown;
  if (type === "date") {
    value = toIsoDate(edit.value);
    if (value === null) return { status: "skipped", reason: "unparseable date", key };
  } else if (type === "select") {
    const opts = (def.options as string[] | null) ?? [];
    const match = opts.length ? opts.find((o) => o.toLowerCase() === edit.value.trim().toLowerCase()) : edit.value.trim();
    if (!match) return { status: "skipped", reason: "not a valid option", key };
    value = match;
  } else {
    value = coerceForType(type, edit.value);
    if (value === null) return { status: "skipped", reason: "empty/invalid value", key };
  }

  // Last-writer-wins: skip if the app changed this field more recently than the sheet edit.
  const { data: row } = await admin
    .from("loan_field_values")
    .select("updated_at,initial_value,verified_value")
    .eq("loan_id", loanId)
    .eq("field_key", key)
    .eq("idx", idx)
    .maybeSingle();
  if (row?.updated_at && new Date(edit.editedAt).getTime() < new Date(row.updated_at).getTime()) {
    return { status: "skipped", reason: "app value is newer", key };
  }
  const hasVerified = row?.verified_value != null && row.verified_value !== "";
  const current = hasVerified ? row?.verified_value : row?.initial_value;
  if (JSON.stringify(current ?? null) === JSON.stringify(value ?? null)) {
    return { status: "ignored", reason: "no change", key };
  }

  const { error } = await upsertFieldValue(admin, {
    loanId,
    key,
    idx,
    valueKind: hasVerified ? "verified" : "initial",
    value,
    actorId: null,
  });
  if (error) return { status: "skipped", reason: error.message, key };

  try {
    await recomputeLoan(loanId);
  } catch {
    /* calc is best-effort */
  }
  await logEvent(admin, {
    loanId,
    actorId: null,
    eventType: "field_updated",
    isInternal: true,
    payload: { key, idx, new: value ?? null, source: "google_sheet" },
  });
  return { status: "applied", key };
}

/**
 * Push the given changed fields (loadFieldValues-form keys) into the loan's sheet. Writes
 * only the mapped input cells — the sheet recomputes its own formulas. No-op without a
 * linked sheet. Best-effort: callers must not let a Drive/Sheets error fail the save.
 */
export async function pushFieldsToSheet(loanId: string, changedKeys: string[]): Promise<void> {
  const locs = changedKeys
    .map((k) => ({ k, loc: FIELD_TO_CELL.get(k) }))
    .filter((x): x is { k: string; loc: Loc } => !!x.loc);
  if (!locs.length) return;

  const admin = createServiceRoleClient();
  const { data: loan } = await admin.from("loans").select("sheet_id").eq("id", loanId).single();
  if (!loan?.sheet_id) return;

  const [fv, { data: defs }] = await Promise.all([
    loadFieldValues(admin, loanId),
    admin.from("field_definitions").select("key,type"),
  ]);
  const typeByKey = new Map((defs ?? []).map((d) => [d.key, d.type as string]));

  const cells = locs.map(({ k, loc }) => {
    const base = k.includes("#") ? k.slice(0, k.indexOf("#")) : k;
    const out = cellValue(typeByKey.get(base), fv[k]?.current);
    return { range: `'${loc.tab}'!${loc.cell}`, value: out ?? "" };
  });
  await writeCells(loan.sheet_id as string, cells);
}
