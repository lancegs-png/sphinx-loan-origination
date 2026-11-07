// P18: seed the DSCR checklist — document_types + program_checklist_items (Checklists tab).
// Idempotent (upsert on document_types.key and (program_id, document_type_id)).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const B = "Borrower documents", L = "Lender documents";
const borrower = "borrower", lender = "lending_team";
// [name, category, assignee, guidance, required]
const ITEMS = [
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

const { data: prog } = await sb.from("loan_programs").select("id").eq("loan_type_key", "dscr").single();
if (!prog) { console.error("no DSCR program"); process.exit(1); }

let sort = 0;
for (const [name, category, assignee, guidance, required] of ITEMS) {
  sort += 10;
  const key = slug(name);
  const { data: dt, error: e1 } = await sb
    .from("document_types")
    .upsert({ key, name, default_review_rules: guidance || null }, { onConflict: "key" })
    .select("id")
    .single();
  if (e1) { console.error(name, e1.message); continue; }
  const { error: e2 } = await sb.from("program_checklist_items").upsert(
    { program_id: prog.id, document_type_id: dt.id, required, assignee, category, sort },
    { onConflict: "program_id,document_type_id" },
  );
  if (e2) console.error(name, e2.message);
}
console.log(`Seeded ${ITEMS.length} DSCR checklist items.`);
