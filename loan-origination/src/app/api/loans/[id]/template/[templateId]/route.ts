import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { loadCompanyConfig } from "@/lib/company";
import { buildDataTapeCsv } from "@/lib/templates/data-tape";
import { buildTemplateData, fillDocx } from "@/lib/templates/docx";
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

  // Tagged .docx closing templates — fill {{key}} with real values.
  if (DOCX_TEMPLATES.has(def.id)) {
    const data = await buildTemplateData(supabase, id);
    const buf = fillDocx(def.id, data);
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
