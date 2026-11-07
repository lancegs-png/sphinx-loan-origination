import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { loadCompanyConfig } from "@/lib/company";
import type { TermSheetData } from "@/lib/term-sheet/document";

const PROP_TYPE: Record<string, string> = {
  sfr: "Single Family Residence",
  "2-4": "2-4 Unit",
  condo: "Condominium",
  nw_condo: "Non-Warrantable Condo",
  str: "Short-Term Rental",
  townhome: "Townhome",
  "multifamily 5+": "Multifamily 5+",
  "mixed use": "Mixed Use",
};
const PREPAY: Record<string, string> = {
  "5yr": "5 Year Stepdown (5,4,3,2,1%)",
  "4yr": "4 Year Stepdown (4,3,2,1%)",
  "3yr": "3 Year Stepdown (3,2,1%)",
  "2yr": "2 Year Stepdown (2,1%)",
  "1yr": "1 Year (1%)",
  none: "None",
};
const PURPOSE: Record<string, string> = {
  purchase: "Purchase",
  rt: "Rate/Term Refinance",
  co: "Cash-Out Refinance",
};

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
function monthlyPI(principal: number | null, ratePct: number | null): number | null {
  if (!principal || !ratePct) return null;
  const r = ratePct / 100 / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -360));
}
function label(map: Record<string, string>, raw: unknown, fallback = "—"): string {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  return map[s.toLowerCase()] ?? s;
}

/**
 * Assemble the DSCR LOI / term-sheet data for a loan from the field store (single
 * source of truth), with pricing figures from the calculated fields, lender details
 * from company config, and the e-signature from custom_fields. Returns null if the
 * caller can't access the loan. Shared by the term-sheet PDF and the template routes.
 */
export async function assembleTermSheetData(
  supabase: SupabaseClient,
  id: string,
): Promise<{ data: TermSheetData; loanNumber: string } | null> {
  const { data: loan } = await supabase
    .from("loans")
    .select("loan_number,opportunity_number,property_address,borrower_name,loan_amount,custom_fields")
    .eq("id", id)
    .single();
  if (!loan) return null;

  const cf = (loan.custom_fields ?? {}) as Record<string, unknown>;
  const q = (cf.quote ?? {}) as Record<string, unknown>;
  const sig = cf.term_sheet as { signed_by?: string; signed_at?: string } | undefined;

  const fv = await loadFieldValues(supabase, id);
  const cur = (k: string): unknown => fv[k]?.current ?? cf[k];
  const company = await loadCompanyConfig(createServiceRoleClient());

  const loanAmount = toNum(cur("loan_amount")) ?? toNum(q.loan_amount) ?? loan.loan_amount ?? null;
  const rateNum = toNum(cur("interest_rate")) ?? toNum(q.rate);
  const ltvNum = toNum(cur("ltv")) ?? toNum(q.ltv);
  const dscrVal = cur("dscr") ?? q.dscr;
  const pandi = toNum(cur("principal_and_interest")) ?? monthlyPI(loanAmount, rateNum);
  const origPct = toNum(cur("origination_fee_pct")) ?? toNum(q.origination_pct);
  const gFirst = (cur("guarantor_first_name") as string) || "";
  const gLast = (cur("guarantor_last_name") as string) || "";
  const guarantor = [gFirst, gLast].filter(Boolean).join(" ") || loan.borrower_name || "—";
  const firstName = gFirst || (loan.borrower_name ? loan.borrower_name.split(" ")[0] : "") || "there";

  const data: TermSheetData = {
    date: new Date().toLocaleDateString("en-US"),
    greetingName: firstName,
    loanAmount: loanAmount ?? 0,
    fico: toNum(cur("guarantor_fico")),
    interestRate: rateNum != null ? `${rateNum}%` : "—",
    propertyValue: toNum(cur("as_is_value")),
    loanProgram: "BPL Term",
    ltv: ltvNum != null ? `${ltvNum}%` : "—",
    propertyType: label(PROP_TYPE, cur("property_type")),
    prepay: label(PREPAY, cur("prepay_type") ?? q.prepay),
    loanTermMonths: 360,
    dscr: dscrVal != null ? String(dscrVal) : "—",
    loanPurpose: label(PURPOSE, cur("loan_purpose")),
    loanType: "30 Year Fixed",
    entity: (cur("borrower_entity") as string) || loan.borrower_name || "—",
    guarantor,
    monthlyPI: pandi,
    originationPct: origPct != null ? origPct.toFixed(2) : "1.00",
    propertyAddress: loan.property_address ?? "—",
    lenderName: company.lender.name,
    lenderSigner: company.lender.signer,
    lenderSignerTitle: company.lender.signer_title,
    signature:
      sig?.signed_by && sig.signed_at
        ? { name: sig.signed_by, dateStr: new Date(sig.signed_at).toLocaleDateString("en-US") }
        : null,
  };
  return { data, loanNumber: loan.loan_number ?? loan.opportunity_number };
}
