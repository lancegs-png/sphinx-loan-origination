// P19: seed company config into app_settings (brief §7). Idempotent.
// Real values: lender + collateral ship-to + seller. Servicers / note buyers are
// seeded as structure with placeholders — confirm legal names / addresses.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const config = {
  lender: {
    name: "Sphinx Capital, LLC",
    address: "1343 Main Street, Suite 705-733, Sarasota, FL 34236",
    signer: "Lance Stukaloff",
    signer_title: "Managing Partner",
  },
  collateral_ship_to:
    "Stride Bank N.A., Attn: Non-QM Collateral, 4700 Gaillardia Pkwy, Suite 200, Oklahoma City, OK 73142",
  seller: "Sphinx Capital LLC",
  // name -> { address, phone, website }. Placeholders — confirm.
  servicers: {
    Shellpoint: { address: "P.O. Box 10826, Greenville, SC 29603", phone: "800-365-7107", website: "shellpointmtg.com" },
  },
  // investor name -> { entity (assignee legal name), address }. Placeholders — confirm.
  note_buyers: {
    Deephaven: { entity: "Deephaven Mortgage LLC", address: "" },
    Eastview: { entity: "", address: "" },
    Churchill: { entity: "", address: "" },
    CoreVest: { entity: "CoreVest American Finance Lender LLC", address: "" },
    Constructive: { entity: "", address: "" },
    Sphinx: { entity: "Sphinx Capital, LLC", address: "1343 Main Street, Suite 705-733, Sarasota, FL 34236" },
  },
};

for (const [key, value] of Object.entries(config)) {
  await sb.from("app_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  console.log("set", key);
}
console.log("done");
