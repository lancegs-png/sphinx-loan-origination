import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { driveConfigured, findDealFolderByStreet, createDealFolder, createDealDashboard, uploadFileToDrive } from "@/lib/google/drive";
import { loadGuarantorNames } from "@/lib/fields";
import { resolveDocumentBaseName, indexedName, fileExt, propertyStreet } from "@/lib/documents/naming";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "loan-documents";

/**
 * Upload one or more documents to a loan, optionally attached to a checklist item.
 * Each file is stored in the private "loan-documents" bucket and, when Google Drive
 * is configured, also mirrored into the deal's Drive folder (created on first use).
 * Lending team only (RLS also enforces the insert).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: loanId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();
  if (!me?.lender_user_type) return new Response("Forbidden", { status: 403 });

  // RLS returns the loan only if the caller has access.
  const { data: loan } = await supabase
    .from("loans")
    .select("id,loan_number,opportunity_number,property_address,drive_folder_id,loan_type")
    .eq("id", loanId)
    .single();
  if (!loan) return new Response("Not found", { status: 404 });

  const form = await req.formData();
  const checklistItemId = (form.get("checklistItemId") as string) || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return new Response("No files provided", { status: 400 });

  const admin = createServiceRoleClient();

  // Ensure a Drive folder exists for this deal (created once), if Drive is configured.
  let driveFolderId = loan.drive_folder_id as string | null;
  const useDrive = driveConfigured();
  if (useDrive && !driveFolderId) {
    try {
      const ref = loan.loan_number ?? loan.opportunity_number;
      const guarantor = (await loadGuarantorNames(supabase))[loanId];
      // Reuse the loan's existing "Open Loan Files" folder (matched by street) if one
      // exists, so we don't create a duplicate; otherwise create one named to match that
      // convention ("<Address> [Guarantor]").
      const existing = await findDealFolderByStreet(propertyStreet(loan.property_address ?? "")).catch(() => null);
      const label =
        [loan.property_address ?? "", guarantor ? `[${guarantor}]` : ""]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim() || String(ref);
      driveFolderId = existing ?? (await createDealFolder(label));

      // Persist the folder id and seed the deal's dashboard in parallel (independent work).
      // The dashboard is DSCR-only for now (the only template), named "Loan Dashboard -
      // <street> - <loan #>"; its copy is best-effort — the folder works without it.
      const dashName =
        (loan.loan_type ?? "").toUpperCase() === "DSCR"
          ? `Loan Dashboard - ${propertyStreet(loan.property_address)} - ${ref}`.replace(/\s+/g, " ").trim()
          : null;
      const [, dashboardId] = await Promise.all([
        admin.from("loans").update({ drive_folder_id: driveFolderId }).eq("id", loanId),
        dashName ? createDealDashboard(driveFolderId, dashName).catch(() => null) : Promise.resolve(null),
      ]);
      // Track the dashboard sheet so "Sync to Google Sheet" writes into it (best-effort:
      // tolerated if the sheet_id column isn't present yet).
      if (dashboardId) {
        await admin.from("loans").update({ sheet_id: dashboardId }).eq("id", loanId).then(
          () => {},
          () => {},
        );
      }
    } catch {
      driveFolderId = null; // fall back to Supabase-only
    }
  }

  // Resolve the naming-convention base for this upload's document type (once — all
  // files in a request share the same checklist item). null => keep original names.
  let docTypeId: string | null = null;
  let docTypeName: string | null = null;
  if (checklistItemId) {
    const { data: ci } = await admin
      .from("loan_checklist_items")
      .select("document_type_id")
      .eq("id", checklistItemId)
      .maybeSingle();
    docTypeId = ci?.document_type_id ?? null;
    if (docTypeId) {
      const { data: dt } = await admin.from("document_types").select("name").eq("id", docTypeId).maybeSingle();
      docTypeName = dt?.name ?? null;
    }
  }
  const baseName = await resolveDocumentBaseName({
    admin,
    loanId,
    loan,
    documentTypeId: docTypeId,
    documentTypeName: docTypeName,
  });

  const created: unknown[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Rename to the convention (2nd+ file of the same type -> "Appraisal 2 - …"); keep
    // the original extension. Falls back to the uploaded name when there's no convention.
    const finalName = baseName ? indexedName(baseName, i, fileExt(file.name)) : file.name;
    const safe = finalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${loanId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
    const contentType = file.type || "application/octet-stream";

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (upErr) return new Response(`Storage upload failed: ${upErr.message}`, { status: 500 });

    let driveFileId: string | null = null;
    let driveLink: string | null = null;
    if (useDrive && driveFolderId) {
      try {
        const r = await uploadFileToDrive({ folderId: driveFolderId, fileName: finalName, bytes, contentType });
        driveFileId = r.id;
        driveLink = r.webViewLink;
      } catch {
        /* best-effort: keep the Supabase copy even if Drive mirroring fails */
      }
    }

    const { data: row, error: insErr } = await supabase
      .from("loan_documents")
      .insert({
        loan_id: loanId,
        checklist_item_id: checklistItemId,
        file_name: finalName,
        content_type: file.type || null,
        size_bytes: file.size,
        storage_path: path,
        drive_file_id: driveFileId,
        drive_web_link: driveLink,
        uploaded_by: user.id,
      })
      .select("id,checklist_item_id,file_name,content_type,size_bytes,drive_web_link,created_at")
      .single();
    if (insErr) {
      await admin.storage.from(BUCKET).remove([path]); // don't orphan the blob
      return new Response(`Save failed: ${insErr.message}`, { status: 500 });
    }
    created.push(row);
    await logEvent(admin, {
      loanId,
      actorId: user.id,
      eventType: "document_uploaded",
      payload: { file_name: finalName, checklist_item_id: checklistItemId },
    });
  }

  return Response.json({ ok: true, documents: created });
}
