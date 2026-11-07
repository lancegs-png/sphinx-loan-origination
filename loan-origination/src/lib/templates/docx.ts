import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { loadCompanyConfig, resolveNoteBuyer } from "@/lib/company";

/** Fill a tagged .docx template ({{key}}) with data; missing tags render blank. */
export function fillDocx(templateId: string, data: Record<string, string>): Buffer {
  const file = path.join(process.cwd(), "src/lib/templates/files", `${templateId}.docx`);
  const zip = new PizZip(readFileSync(file));
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "", // blanks stay blank, no error on absent tags
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}

const money = (v: unknown) => `$${Math.round(Number(v)).toLocaleString("en-US")}`;

/**
 * Flat {{tag}} -> value map for the closing templates, from the field store plus
 * company config (lender signer, servicer details, note buyer). Currency/percent/date
 * fields are formatted; blanks stay blank.
 */
export async function buildTemplateData(
  supabase: SupabaseClient,
  loanId: string,
): Promise<Record<string, string>> {
  const { data: loan } = await supabase
    .from("loans")
    .select("loan_number,property_address")
    .eq("id", loanId)
    .single();
  const fv = await loadFieldValues(supabase, loanId);
  const admin = createServiceRoleClient();
  const [{ data: defs }, company] = await Promise.all([
    admin.from("field_definitions").select("key,type"),
    loadCompanyConfig(admin),
  ]);
  const typeOf = Object.fromEntries((defs ?? []).map((d) => [d.key, d.type]));

  const fmt = (key: string, v: unknown): string => {
    if (v == null || v === "") return "";
    const t = typeOf[key];
    if (t === "currency") return money(v);
    if (t === "percent") return `${v}%`;
    if (t === "date") {
      const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[2]}/${m[3]}/${m[1]}` : String(v);
    }
    return String(v);
  };

  const out: Record<string, string> = {};
  for (const [k, cell] of Object.entries(fv)) {
    if (k.includes("#")) continue; // idx 1 only for these templates
    out[k] = fmt(k, cell.current);
  }
  out.loan_number = loan?.loan_number ?? "";
  if (!out.property_address && loan?.property_address) out.property_address = loan.property_address;

  // Company config.
  out.lender_signer = company.lender.signer;
  out.lender_signer_title = company.lender.signer_title;
  const servicerName = fv.servicer_name?.current as string | undefined;
  const srv = servicerName ? company.servicers[servicerName] : undefined;
  out.servicer_address = srv?.address ?? "";
  out.servicer_phone = srv?.phone ?? "";
  out.servicer_website = srv?.website ?? "";
  const nb = resolveNoteBuyer(company, fv.investor_name?.current as string | undefined, {
    entity: fv.note_buyer_entity?.current as string | undefined,
    address: fv.note_buyer_address?.current as string | undefined,
  });
  out.note_buyer_entity = nb.entity;
  out.note_buyer_address = nb.address;

  // Defaults for fields that are conventionally fixed on the LOI.
  if (!out.rate_buydown_pct) out.rate_buydown_pct = "0%";

  return out;
}
