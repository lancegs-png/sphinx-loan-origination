import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues, upsertFieldValue } from "@/lib/fields";
import { loadCompanyConfig } from "@/lib/company";
import { buildDataTapeCsv } from "@/lib/templates/data-tape";
import { buildMismoXml } from "@/lib/templates/mismo";
import { buildTemplateData, fillDocx, money } from "@/lib/templates/docx";
import { docxToPdf } from "@/lib/templates/pdf";
import { renderDocTemplate, docTemplatesConfigured } from "@/lib/google/docs";
import { logEvent } from "@/lib/audit";
import { TEMPLATES } from "@/lib/templates/registry";

const DOCX_TEMPLATES = new Set([
  "dscr_loi",
  "rtl_loi_sphinx",
  "rtl_loi_wl",
  "ach_form",
  "first_payment_letter",
  "assignment_allonge",
]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Each tagged template can render from a Google Doc (copy → replace {{tags}} → export),
// which works on Vercel. The Doc id lives in the template's own env var; when it's unset,
// the request falls back to the bundled .docx path (needs LibreOffice, local-only).
const DOC_TEMPLATE_ENV: Record<string, string> = {
  dscr_loi: "GOOGLE_LOI_TEMPLATE_DOC_ID",
  rtl_loi_sphinx: "GOOGLE_RTL_LOI_SPHINX_TEMPLATE_DOC_ID",
  rtl_loi_wl: "GOOGLE_RTL_LOI_WL_TEMPLATE_DOC_ID",
  ach_form: "GOOGLE_ACH_TEMPLATE_DOC_ID",
  first_payment_letter: "GOOGLE_FIRST_PAYMENT_TEMPLATE_DOC_ID",
  assignment_allonge: "GOOGLE_ASSIGNMENT_TEMPLATE_DOC_ID",
};
// Tags present in a template but not produced by buildTemplateData (filled only on in-app
// signing) — blanked so they never render as literal {{tags}}.
const DOC_TEMPLATE_BLANKS: Record<string, Record<string, string>> = {
  dscr_loi: { signature_name: "", signature_sig: "", signature_date: "" },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { id, templateId } = await params;
  const asPdf = new URL(req.url).searchParams.get("format") === "pdf";
  const def = TEMPLATES.find((t) => t.id === templateId);
  if (!def || !def.generatable) return new Response("Template not available", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: loan } = await supabase
    .from("loans")
    .select("loan_number,opportunity_number,property_address")
    .eq("id", id)
    .single();
  if (!loan) return new Response("Not found", { status: 404 });
  const ref = loan.loan_number ?? loan.opportunity_number;
  const street = (loan.property_address || ref).split(",")[0].trim();

  // Log the download (internal). def.name falls back to the id.
  await logEvent(createServiceRoleClient(), {
    loanId: id,
    actorId: user.id,
    eventType: "template_downloaded",
    isInternal: true,
    payload: {
      template: (def as { name?: string }).name ?? def.id,
      format:
        def.id === "data_tape" ? "csv" : def.id === "mismo_3_4" ? "xml" : asPdf ? "pdf" : "docx",
    },
  });

  // Stamp the generation date on the LOI / commitment-letter date field (updates on
  // each generation) BEFORE the template is filled, so the document shows that date.
  if (def.id.includes("loi") || def.id.includes("commitment")) {
    await upsertFieldValue(createServiceRoleClient(), {
      loanId: id,
      key: def.id.includes("commitment") ? "commitment_date" : "term_sheet_date",
      valueKind: "initial",
      value: new Date().toISOString().slice(0, 10),
    });
  }

  // Data tape: one row per property, exact Data Tape Map columns, blanks stay blank.
  if (def.id === "data_tape") {
    const fv = await loadFieldValues(supabase, id);
    const cur = (key: string, idx = 1) => fv[idx > 1 ? `${key}#${idx}` : key]?.current;
    const company = await loadCompanyConfig(createServiceRoleClient());
    const csv = buildDataTapeCsv({ cur, loanNumber: ref, seller: company.seller });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Data Tape - ${street}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // MISMO 3.4 (ULAD) XML export — built from current field values.
  if (def.id === "mismo_3_4") {
    const fv = await loadFieldValues(supabase, id);
    const cur = (key: string, idx = 1) => fv[idx > 1 ? `${key}#${idx}` : key]?.current;
    const xml = buildMismoXml({ cur, loanNumber: ref });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="MISMO 3.4 - ${street}.xml"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Tagged .docx closing templates — fill {{key}} with real values.
  if (DOCX_TEMPLATES.has(def.id)) {
    const data = await buildTemplateData(supabase, id);

    // ACH form: the "Borrower Email" / "Borrower Phone" tags are the signer's contact, so
    // fill them from the guarantor's email and phone rather than the borrower_* fields.
    if (def.id === "ach_form") {
      data.borrower_email = data.guarantor_email ?? "";
      data.borrower_phone = data.guarantor_phone ?? "";
    }

    // RTL LOI: a few presentation-only values the letter needs that aren't dictionary fields —
    // guarantor full name, the Closing Estimate block (down payment, cash to close, the sheet's
    // closing-cost estimate = origination + 1% of the total), and the additional-fees line.
    if (def.id === "rtl_loi_sphinx" || def.id === "rtl_loi_wl") {
      const fv = await loadFieldValues(supabase, id);
      const n = (k: string): number | null => {
        const v = fv[k]?.current;
        if (v == null || v === "") return null;
        const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
        return Number.isFinite(x) ? x : null;
      };
      const first = (fv.guarantor_first_name?.current as string | undefined) ?? "";
      const last = (fv.guarantor_last_name?.current as string | undefined) ?? "";
      data.guarantor_full_name = [first, last].filter(Boolean).join(" ");

      const total = n("total_loan_amount");
      const initial = n("initial_loan_amount");
      const purchase = n("purchase_price");
      const payoff = n("payoff_amount");
      const origPct = n("origination_fee_pct");
      const uw = n("underwriting_fee");
      const legal = n("legal_fee");
      const isPurchase = /purchase/i.test(String(fv.loan_purpose?.current ?? ""));

      // Estimated closing costs = origination fee + a 1% buffer of the total (term-sheet formula).
      const estClosing = total != null && origPct != null ? (total * (origPct + 1)) / 100 : null;
      data.est_closing_costs = estClosing != null ? money(estClosing) : "";

      // Down payment (purchases only): borrower equity = purchase price − initial advance.
      const down = isPurchase && purchase != null && initial != null ? purchase - initial : null;
      data.down_payment = down != null ? money(down) : "N/A";

      // Estimated cash to close: purchase = down + closing; refinance = payoff + closing − total
      // when the borrower must bring cash, else N/A (cash-out or break-even).
      let cash: number | null = null;
      if (isPurchase && down != null && estClosing != null) cash = down + estClosing;
      else if (!isPurchase && payoff != null && estClosing != null && total != null) {
        const c = payoff + estClosing - total;
        cash = c > 0 ? c : null;
      }
      data.est_cash_to_close = cash != null ? money(cash) : "N/A";

      const fees: string[] = [];
      if (uw != null) fees.push(`${money(uw)} underwriting fee`);
      if (legal != null) fees.push(`${money(legal)} legal fee`);
      data.additional_fees = fees.join(", ");

      // Keep the term-sheet expiration fresh (the generation date was just stamped): date + 7 days.
      const exp = new Date();
      exp.setDate(exp.getDate() + 7);
      const pad = (x: number) => String(x).padStart(2, "0");
      data.term_sheet_expiration_date = `${pad(exp.getMonth() + 1)}/${pad(exp.getDate())}/${exp.getFullYear()}`;
    }

    // Preferred path: render from the template's Google Doc (per DOC_TEMPLATE_ENV) — copy,
    // replace {{tags}}, export PDF/Word, all inside the org's own Workspace (works on
    // Vercel, no LibreOffice). Templates whose env var is unset fall through to the bundled
    // .docx. Any tags not produced by buildTemplateData are blanked (DOC_TEMPLATE_BLANKS).
    const docEnv = DOC_TEMPLATE_ENV[def.id];
    const docTemplateId = docEnv ? process.env[docEnv] : undefined;
    if (docTemplateId && docTemplatesConfigured()) {
      const filled = { ...data, ...(DOC_TEMPLATE_BLANKS[def.id] ?? {}) };
      try {
        const out = await renderDocTemplate(docTemplateId, filled, asPdf ? "pdf" : "docx");
        return new Response(new Uint8Array(out), {
          headers: {
            "Content-Type": asPdf ? "application/pdf" : DOCX_MIME,
            "Content-Disposition": `${asPdf ? "inline" : "attachment"}; filename="${def.name} - ${street}.${asPdf ? "pdf" : "docx"}"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return new Response(e instanceof Error ? e.message : "Document export failed.", { status: 503 });
      }
    }

    const buf = fillDocx(def.id, data);
    if (asPdf) {
      try {
        const pdf = await docxToPdf(buf); // LibreOffice: faithful .docx -> PDF
        return new Response(new Uint8Array(pdf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${def.name} - ${street}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return new Response(e instanceof Error ? e.message : "PDF export failed.", { status: 503 });
      }
    }
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": `attachment; filename="${def.name} - ${street}.docx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response("Template not available", { status: 404 });
}
