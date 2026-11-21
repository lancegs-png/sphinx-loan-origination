import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/audit";

/**
 * Store the completed + signed application PDF in a "Loan application" Documents slot and turn that
 * slot Yellow (`update_needed`) with the note "Ready for Review". Runs service-role from the public
 * submit (no auth user), so it writes the checklist status directly rather than via the lender action.
 */

const BUCKET = "loan-documents";
const DOC_TYPE_KEY = "loan_application";
const DOC_TYPE_NAME = "Loan application";

/** Find-or-create the "Loan application" document type; returns its id. */
async function ensureDocumentType(admin: SupabaseClient): Promise<string> {
  const { data: existing } = await admin
    .from("document_types")
    .select("id")
    .eq("key", DOC_TYPE_KEY)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data, error } = await admin
    .from("document_types")
    .insert({ key: DOC_TYPE_KEY, name: DOC_TYPE_NAME })
    .select("id")
    .single();
  if (error) throw new Error(`document type: ${error.message}`);
  return data.id as string;
}

/** Find-or-create the loan's checklist slot for a document type; returns the item id. */
async function ensureChecklistItem(admin: SupabaseClient, loanId: string, docTypeId: string): Promise<string> {
  await admin
    .from("loan_checklist_items")
    .upsert(
      { loan_id: loanId, document_type_id: docTypeId, status: "outstanding" },
      { onConflict: "loan_id,document_type_id", ignoreDuplicates: true },
    );
  const { data } = await admin
    .from("loan_checklist_items")
    .select("id")
    .eq("loan_id", loanId)
    .eq("document_type_id", docTypeId)
    .maybeSingle();
  if (!data?.id) throw new Error("checklist item not found after upsert");
  return data.id as string;
}

export async function placeSignedApplication(
  admin: SupabaseClient,
  loanId: string,
  pdfBytes: Uint8Array,
  fileName = "Loan Application (signed).pdf",
): Promise<void> {
  const docTypeId = await ensureDocumentType(admin);
  const itemId = await ensureChecklistItem(admin, loanId, docTypeId);

  const safe = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const storagePath = `${loanId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`storage upload: ${upErr.message}`);

  const { error: insErr } = await admin.from("loan_documents").insert({
    loan_id: loanId,
    checklist_item_id: itemId,
    file_name: fileName,
    content_type: "application/pdf",
    size_bytes: pdfBytes.byteLength,
    storage_path: storagePath,
    uploaded_by: null,
    visibility: "internal", // the signed PDF carries SSN/DOB — lending team only
  });
  if (insErr) {
    await admin.storage.from(BUCKET).remove([storagePath]); // don't orphan the blob
    throw new Error(`loan_documents insert: ${insErr.message}`);
  }

  await admin
    .from("loan_checklist_items")
    .update({ status: "update_needed", notes: "Ready for Review", updated_at: new Date().toISOString() })
    .eq("id", itemId);

  await logEvent(admin, {
    loanId,
    actorKind: "system",
    eventType: "application_received",
    payload: { file_name: fileName },
  });
}
