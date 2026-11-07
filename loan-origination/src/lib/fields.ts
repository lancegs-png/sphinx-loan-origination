import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldValues } from "@/lib/types";

/** Load a loan's field values (current = verified ?? initial) keyed for the UI. */
export async function loadFieldValues(
  supabase: SupabaseClient,
  loanId: string,
): Promise<FieldValues> {
  const { data } = await supabase
    .from("loan_field_values")
    .select("field_key,idx,initial_value,verified_value,locked")
    .eq("loan_id", loanId);
  const out: FieldValues = {};
  for (const r of data ?? []) {
    const k = r.idx > 1 ? `${r.field_key}#${r.idx}` : r.field_key;
    out[k] = {
      initial: r.initial_value,
      verified: r.verified_value,
      locked: r.locked,
      current: r.verified_value ?? r.initial_value,
    };
  }
  return out;
}

export function coerceForType(type: string, raw: string): unknown {
  if (raw === "") return null;
  if (type === "number" || type === "currency" || type === "percent") {
    const n = parseFloat(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

/** Upsert one field value (initial or verified) without clobbering the other kind. */
export async function upsertFieldValue(
  client: SupabaseClient,
  opts: {
    loanId: string;
    key: string;
    idx?: number;
    valueKind: "initial" | "verified";
    value: unknown;
    actorId?: string | null;
  },
): Promise<{ error: { message: string } | null }> {
  const col = opts.valueKind === "verified" ? "verified_value" : "initial_value";
  const row: Record<string, unknown> = {
    loan_id: opts.loanId,
    field_key: opts.key,
    idx: opts.idx ?? 1,
    [col]: opts.value,
    updated_by: opts.actorId ?? null,
  };
  const { error } = await client
    .from("loan_field_values")
    .upsert(row, { onConflict: "loan_id,field_key,idx" });
  return { error: error ? { message: error.message } : null };
}

/** Lock or unlock a field value. */
export async function setFieldLockRow(
  client: SupabaseClient,
  opts: { loanId: string; key: string; idx?: number; locked: boolean; actorId?: string | null },
): Promise<{ error: { message: string } | null }> {
  const row = {
    loan_id: opts.loanId,
    field_key: opts.key,
    idx: opts.idx ?? 1,
    locked: opts.locked,
    locked_by: opts.locked ? opts.actorId ?? null : null,
    locked_at: opts.locked ? new Date().toISOString() : null,
  };
  const { error } = await client
    .from("loan_field_values")
    .upsert(row, { onConflict: "loan_id,field_key,idx" });
  return { error: error ? { message: error.message } : null };
}

// Legacy intake keys -> dictionary keys (bridge until the intake agent is reworked in P17).
// Value is the dictionary key, [key, idx] for a repeat, or null to drop.
const LEGACY_MAP: Record<string, string | [string, number] | null> = {
  borrower_name: "borrower_entity",
  entity_name: "borrower_entity",
  guarantor_credit: "guarantor_fico",
  property_value: "as_is_value",
  origination_pct: "origination_fee_pct",
  purchase_or_refinance: "loan_purpose",
  construction_budget: "rehab_budget",
  interest_only_months: "io_months",
  // targets that are calculated or have no single field -> drop (calc module / later)
  loan_amount: null,
  property_address: null,
  requested_ltv: null,
  annual_taxes_insurance_hoa: null,
};

const mapPurpose = (v: unknown): unknown => {
  const s = String(v).toLowerCase();
  if (s.includes("cash")) return "Refinance - Cash Out";
  if (s.includes("refi") || s.includes("rate")) return "Refinance - Rate and Term";
  if (s.includes("purchase") || s.includes("buy")) return "Purchase";
  return v;
};

/**
 * Bridge intake-captured facts into loan_field_values as initial values.
 * `defs` maps dictionary key -> { type, source } so we coerce and skip calculated.
 * Uses the caller's client (service role for intake). P17 replaces this with a
 * dictionary-native record_intake schema.
 */
export async function writeIntakeFields(
  client: SupabaseClient,
  loanId: string,
  raw: Record<string, unknown>,
  defs: Record<string, { type: string; source: string | null }>,
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const [srcKey, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === "") continue;
    let key = srcKey;
    let idx = 1;
    if (srcKey in LEGACY_MAP) {
      const m = LEGACY_MAP[srcKey];
      if (m === null) continue;
      if (Array.isArray(m)) {
        key = m[0];
        idx = m[1];
      } else {
        key = m;
      }
    }
    const def = defs[key];
    if (!def || def.source === "calculated") continue; // unknown or read-only
    let v: unknown = value;
    if (key === "loan_purpose") v = mapPurpose(value);
    else if (typeof value === "string") v = coerceForType(def.type, value);
    rows.push({ loan_id: loanId, field_key: key, idx, initial_value: v });
  }
  if (rows.length) {
    await client.from("loan_field_values").upsert(rows, { onConflict: "loan_id,field_key,idx" });
  }
}
