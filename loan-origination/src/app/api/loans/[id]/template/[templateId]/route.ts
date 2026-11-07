import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { assembleTermSheetData } from "@/lib/term-sheet/data";
import { renderTermSheetPdf } from "@/lib/term-sheet/document";
import { loadFieldValues } from "@/lib/fields";
import { loadCompanyConfig } from "@/lib/company";
import { buildDataTapeCsv } from "@/lib/templates/data-tape";
import { TEMPLATES } from "@/lib/templates/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { id, templateId } = await params;
  const def = TEMPLATES.find((t) => t.id === templateId);
  if (!def || !def.generatable) return new Response("Template not available", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: loan } = await supabase.from("loans").select("loan_number,property_address").eq("id", id).single();
  if (!loan) return new Response("Not found", { status: 404 });
  const street = (loan.property_address || loan.loan_number).split(",")[0].trim();

  // Data tape: one row per property, exact Data Tape Map columns, blanks stay blank.
  if (def.id === "data_tape") {
    const fv = await loadFieldValues(supabase, id);
    const cur = (key: string, idx = 1) => fv[idx > 1 ? `${key}#${idx}` : key]?.current;
    const company = await loadCompanyConfig(createServiceRoleClient());
    const csv = buildDataTapeCsv({ cur, loanNumber: loan.loan_number, seller: company.seller });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Data Tape - ${street}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // DSCR LOI. (Served as PDF for now; .docx fill lands once the real templates arrive.)
  const assembled = await assembleTermSheetData(supabase, id);
  if (!assembled) return new Response("Not found", { status: 404 });
  const pdf = await renderTermSheetPdf(assembled.data);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${def.name} - ${street}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
