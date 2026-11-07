// P17: set the intake field lists (dictionary keys) that drive the chat intake —
// global base fields + per-program (DSCR, RTL) adds. Idempotent. Brief §5.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Base set (all programs) — loan_program is handled by loan_type_key, so not listed.
const BASE = [
  "loan_purpose", "property_street", "property_city", "property_state", "property_zip",
  "property_type", "unit_count", "as_is_value", "payoff_amount", "borrower_entity",
  "guarantor_first_name", "guarantor_last_name", "guarantor_email", "guarantor_phone",
  "guarantor_fico", "source_channel",
];
const DSCR = ["monthly_rent", "annual_taxes", "annual_insurance", "annual_hoa"];
const RTL = ["purchase_price", "rehab_budget", "arv", "experience_property_count"];
const NOT_REQUIRED = new Set(["payoff_amount"]); // refinance only

const { data: defs } = await sb.from("field_definitions").select("key,label,type,options");
const DEF = Object.fromEntries((defs || []).map((d) => [d.key, d]));

const toQuoteField = (key) => {
  const d = DEF[key];
  if (!d) { console.warn("  !! missing field_definition:", key); return null; }
  const type = d.type === "percent" ? "number" : d.type; // intake FieldType has no 'percent'
  const qf = { key, label: d.label, type, required: !NOT_REQUIRED.has(key) };
  if (type === "select" && Array.isArray(d.options) && d.options.length) qf.options = d.options;
  return qf;
};
const build = (keys) => keys.map(toQuoteField).filter(Boolean);

// 1. Global base fields (merge into app_settings.intake_global, preserving style/examples).
const { data: gRow } = await sb.from("app_settings").select("value").eq("key", "intake_global").maybeSingle();
const gVal = { ...(gRow?.value ?? {}), base_fields: build(BASE) };
await sb.from("app_settings").upsert({ key: "intake_global", value: gVal, updated_at: new Date().toISOString() }, { onConflict: "key" });
console.log("global base_fields:", gVal.base_fields.length);

// 2. Per-program adds.
for (const [typeKey, keys] of [["dscr", DSCR], ["rtl", RTL]]) {
  const { data: prog } = await sb.from("loan_programs").select("id").eq("loan_type_key", typeKey).maybeSingle();
  if (!prog) { console.warn("  !! no program for", typeKey); continue; }
  const { data: existing } = await sb.from("program_ai_config").select("program_id").eq("program_id", prog.id).maybeSingle();
  const row = { program_id: prog.id, quote_fields: build(keys), updated_at: new Date().toISOString() };
  await sb.from("program_ai_config").upsert(row, { onConflict: "program_id" });
  console.log(`${typeKey} quote_fields:`, row.quote_fields.map((f) => f.key).join(", "), existing ? "(updated)" : "(created)");
}
