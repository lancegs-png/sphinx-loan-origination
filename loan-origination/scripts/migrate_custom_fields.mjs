// Migrate loans.custom_fields + loan_trade.values into loan_field_values (as initial_value).
// Maps legacy keys -> dictionary keys. Skips calculated targets (the calc module fills
// those), unmapped keys, and the quote/term_sheet blobs (handled/▸left per D5). Idempotent.
// Non-destructive: custom_fields / loan_trade are left in place for cleanup migration 0010.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// legacy key -> dictionary key, or [key, idx], or null to skip.
const MAP = {
  guarantor_credit: "guarantor_fico",
  entity_name: "borrower_entity",
  property_value: "as_is_value",
  origination_pct: "origination_fee_pct",
  purchase_or_refinance: "loan_purpose",
  construction_budget: "rehab_budget",
  interest_only_months: "io_months",
  lock_expiration: "lock_expiration_date",
  servicer: "servicer_name",
  servicer_id: "servicing_number",
  buy_price: "purchase_price",
  loan_type: "loan_program",
  expected_close_date: "closing_date",
  guarantor2_first_name: ["guarantor_first_name", 2],
  guarantor2_last_name: ["guarantor_last_name", 2],
  guarantor2_credit: ["guarantor_fico", 2],
  requested_ltv: null,               // ltv is calculated
  annual_taxes_insurance_hoa: null,  // no single target
};
const SKIP_BLOBS = new Set(["quote", "term_sheet"]);

const mapPurpose = (v) => {
  const s = String(v).toLowerCase();
  if (s.includes("cash")) return "Refinance - Cash Out";
  if (s.includes("refi") || s.includes("rate")) return "Refinance - Rate and Term";
  if (s.includes("purchase") || s.includes("buy")) return "Purchase";
  return v;
};

const { data: defs } = await sb.from("field_definitions").select("key,type,source");
const DEF = Object.fromEntries(defs.map((d) => [d.key, d]));
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };
const coerce = (key, v) => {
  const t = DEF[key]?.type;
  if (t === "number" || t === "currency" || t === "percent") return num(v);
  return v;
};

// Reset: loan_field_values currently holds only prior migration output, so clear it
// for a clean, correct re-run (removes any rows written to orphan keys).
await sb.from("loan_field_values").delete().neq("loan_id", "00000000-0000-0000-0000-000000000000");

const { data: loans } = await sb.from("loans").select("id,loan_number,custom_fields");
const { data: trades } = await sb.from("loan_trade").select("loan_id,values");
const tradeByLoan = Object.fromEntries((trades || []).map((t) => [t.loan_id, t.values || {}]));

const skipped = [];
let migrated = 0;

for (const loan of loans) {
  const cf = loan.custom_fields || {};
  // priority: direct dictionary key (2) beats mapped legacy key (1)
  const picked = new Map(); // `${key}|${idx}` -> { key, idx, value, prio }
  const consider = (key, idx, value, prio) => {
    if (value === null || value === undefined || value === "") return;
    if (DEF[key]?.source === "calculated") { skipped.push(`${loan.loan_number}:${key} (calculated)`); return; }
    const id = `${key}|${idx}`;
    const ex = picked.get(id);
    if (!ex || prio > ex.prio) picked.set(id, { key, idx, value, prio });
  };

  const handleSource = (srcKey, rawVal) => {
    if (SKIP_BLOBS.has(srcKey)) return; // blobs handled below / left in place
    let target, idx = 1, prio;
    // MAP takes precedence over a still-existing orphan field_definitions key.
    if (srcKey in MAP) {
      const m = MAP[srcKey];
      if (m === null) { skipped.push(`${loan.loan_number}:${srcKey} (no target)`); return; }
      if (Array.isArray(m)) { target = m[0]; idx = m[1]; } else { target = m; }
      prio = 1;
    } else if (DEF[srcKey]) {
      target = srcKey; prio = 2;
    } else {
      skipped.push(`${loan.loan_number}:${srcKey} (unmapped)`); return;
    }
    let val = rawVal;
    if (target === "loan_purpose") val = mapPurpose(rawVal);
    consider(target, idx, coerce(target, val), prio);
  };

  for (const [k, v] of Object.entries(cf)) handleSource(k, v);

  // quote blob (D5): migrate the useful *inputs* (rate, origination %); ltv/dscr/pitia/amount are calculated.
  if (cf.quote && typeof cf.quote === "object") {
    if (cf.quote.rate != null) consider("interest_rate", 1, coerce("interest_rate", cf.quote.rate), 2);
    if (cf.quote.origination_pct != null) consider("origination_fee_pct", 1, coerce("origination_fee_pct", cf.quote.origination_pct), 2);
  }

  // loan_trade values (lender-only trade fields)
  for (const [k, v] of Object.entries(tradeByLoan[loan.id] || {})) handleSource(k, v);

  const rows = [...picked.values()].map((p) => ({
    loan_id: loan.id, field_key: p.key, idx: p.idx, initial_value: p.value,
  }));
  if (rows.length) {
    const { error } = await sb.from("loan_field_values")
      .upsert(rows, { onConflict: "loan_id,field_key,idx" });
    if (error) { console.log(`  ${loan.loan_number} ERROR:`, error.message); }
    else { migrated += rows.length; console.log(`  ${loan.loan_number}: ${rows.length} fields -> ${rows.map(r=>r.field_key+(r.idx>1?`#${r.idx}`:"")).join(", ")}`); }
  }
}

console.log(`\nMigrated ${migrated} field values.`);
console.log("Skipped:", skipped.length ? skipped.join("; ") : "none");
