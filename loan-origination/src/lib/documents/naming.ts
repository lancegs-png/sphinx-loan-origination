import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Document naming conventions (from the DSCR dashboard template, column H). Stored in
 * `app_settings` under key `document_naming` so it's editable without a code change:
 *   { default, property_style, templates: { <document_type_id>: "<template>" } }
 * Templates use tokens {{Property_Address}}, {{Loan Number}}, {{Guarantor_Name}},
 * {{Borrowing_Entity}} and (for the default) {{Document_Type}}.
 */
export type NamingConfig = {
  default: string;
  property_style?: string;
  templates: Record<string, string>;
};

export async function loadNamingConfig(admin: SupabaseClient): Promise<NamingConfig | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "document_naming").maybeSingle();
  const v = data?.value as NamingConfig | undefined;
  return v && v.templates ? v : null;
}

/** Strip characters that aren't safe in a file name. */
function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The extension (including the dot) of a file name, or "". */
export function fileExt(name: string): string {
  const m = name.match(/\.[A-Za-z0-9]{1,8}$/);
  return m ? m[0] : "";
}

/**
 * Resolve the convention base name (no extension, no multi-file index) for a document,
 * or null to keep the original file name (no config, or an unassigned upload with no type).
 */
export async function resolveDocumentBaseName(opts: {
  admin: SupabaseClient;
  loanId: string;
  loan: { loan_number?: string | null; opportunity_number?: string | null; property_address?: string | null };
  documentTypeId: string | null;
  documentTypeName: string | null;
}): Promise<string | null> {
  const cfg = await loadNamingConfig(opts.admin);
  if (!cfg) return null;

  let template = opts.documentTypeId ? cfg.templates[opts.documentTypeId] : undefined;
  if (!template) {
    if (!opts.documentTypeName) return null; // unassigned upload with no type: keep original
    template = cfg.default;
  }

  const loanNo = opts.loan.loan_number ?? opts.loan.opportunity_number ?? "";
  // {Property} renders as the street only (first comma-segment), per the chosen convention.
  const street = (opts.loan.property_address ?? "").split(",")[0].trim();

  const { data: fv } = await opts.admin
    .from("loan_field_values")
    .select("field_key,initial_value,verified_value")
    .eq("loan_id", opts.loanId)
    .in("field_key", ["guarantor_first_name", "guarantor_last_name", "borrower_entity"])
    .eq("idx", 1);
  const val = (k: string) => {
    const r = (fv ?? []).find((x) => x.field_key === k);
    return r ? String(r.verified_value ?? r.initial_value ?? "") : "";
  };
  const guarantor = [val("guarantor_first_name"), val("guarantor_last_name")].filter(Boolean).join(" ");
  const entity = val("borrower_entity");

  const filled = template
    .replace(/\{\{\s*Property_Address\s*\}\}/gi, street)
    .replace(/\{\{\s*Loan[_ ]?Number\s*\}\}/gi, loanNo)
    .replace(/\{\{\s*Guarantor_Name\s*\}\}/gi, guarantor)
    .replace(/\{\{\s*Borrowing_Entity\s*\}\}/gi, entity)
    .replace(/\{\{\s*Document_Type\s*\}\}/gi, opts.documentTypeName ?? "");

  // Collapse separators left empty by a missing token ("X -  - Y" -> "X - Y"; trim dangling "-").
  const cleaned = sanitize(filled)
    .replace(/(?:\s-\s)(?:-\s)+/g, " - ")
    .replace(/^\s*-\s*|\s*-\s*$/g, "")
    .trim();
  return cleaned || null;
}

/**
 * Apply the multi-file index to the label: file 0 -> "Appraisal - X",
 * file 1 -> "Appraisal 2 - X", file 2 -> "Appraisal 3 - X". Then append the extension.
 */
export function indexedName(base: string, i: number, ext: string): string {
  if (i <= 0) return base + ext;
  const n = i + 1;
  const sep = base.indexOf(" - ");
  const labeled = sep === -1 ? `${base} ${n}` : `${base.slice(0, sep)} ${n}${base.slice(sep)}`;
  return labeled + ext;
}
