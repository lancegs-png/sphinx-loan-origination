import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { loadCompanyConfig } from "@/lib/company";
import { buildDataTapeCsv } from "@/lib/templates/data-tape";
import { buildTemplateData, fillDocx } from "@/lib/templates/docx";
import { docxToPdf } from "@/lib/templates/pdf";
import { logEvent } from "@/lib/audit";
import { TEMPLATES } from "@/lib/templates/registry";

const DOCX_TEMPLATES = new Set([
  "dscr_loi",
  "ach_form",
  "first_payment_letter",
  "assignment_allonge",
]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
      format: def.id === "data_tape" ? "csv" : asPdf ? "pdf" : "docx",
    },
  });

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

  // Tagged .docx closing templates — fill {{key}} with real values.
  if (DOCX_TEMPLATES.has(def.id)) {
    const data = await buildTemplateData(supabase, id);
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
