import { createClient } from "@/lib/supabase/server";
import { loadFieldValues } from "@/lib/fields";
import { renderTermSheetPdf, type TermSheetData } from "@/lib/term-sheet/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROP_TYPE: Record<string, string> = {
  sfr: "Single Family Residence",
  "2-4": "2-4 Unit",
  condo: "Condominium",
  nw_condo: "Non-Warrantable Condo",
  str: "Short-Term Rental",
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
  const n = 360;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function label(map: Record<string, string>, raw: unknown, fallback = "—"): string {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  return map[s.toLowerCase()] ?? s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // RLS: a non-participant gets no row -> treat as not found.
  const { data: loan } = await supabase
    .from("loans")
    .select("loan_number,property_address,borrower_name,loan_amount,custom_fields")
    .eq("id", id)
    .single();
  if (!loan) return new Response("Not found", { status: 404 });

  const cf = (loan.custom_fields ?? {}) as Record<string, unknown>;
  const q = (cf.quote ?? {}) as Record<string, unknown>;
  const sig = cf.term_sheet as { signed_by?: string; signed_at?: string } | undefined;

  // The loan field store is the single source of truth; ltv/dscr/loan_amount/P&I are
  // calculated fields (P16). The legacy quote blob is only a fallback for old loans.
  const fv = await loadFieldValues(supabase, id);
  const cur = (k: string): unknown => fv[k]?.current ?? cf[k];

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
    signature:
      sig?.signed_by && sig.signed_at
        ? { name: sig.signed_by, dateStr: new Date(sig.signed_at).toLocaleDateString("en-US") }
        : null,
  };

  const pdf = await renderTermSheetPdf(data);
  const filename = `Term Sheet - ${loan.loan_number}${data.signature ? " (signed)" : ""}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
