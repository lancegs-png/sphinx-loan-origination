import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { deleteDriveFile } from "@/lib/google/drive";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "loan-documents";

/** Open/download a document: redirects to a short-lived signed URL. Access via RLS. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id: loanId, docId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // RLS returns the row only if the caller has loan access.
  const { data: doc } = await supabase
    .from("loan_documents")
    .select("storage_path")
    .eq("id", docId)
    .eq("loan_id", loanId)
    .single();
  if (!doc?.storage_path) return new Response("Not found", { status: 404 });

  const admin = createServiceRoleClient();
  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
  if (error || !signed) return new Response("Could not generate link", { status: 500 });

  return Response.redirect(signed.signedUrl, 302);
}

/** Delete a document (lending team, enforced by RLS): removes the row, blob, and Drive copy. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id: loanId, docId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: doc } = await supabase
    .from("loan_documents")
    .select("storage_path,drive_file_id,file_name")
    .eq("id", docId)
    .eq("loan_id", loanId)
    .single();
  if (!doc) return new Response("Not found", { status: 404 });

  const { error: delErr } = await supabase.from("loan_documents").delete().eq("id", docId);
  if (delErr) return new Response(delErr.message, { status: 403 });

  const admin = createServiceRoleClient();
  if (doc.storage_path) await admin.storage.from(BUCKET).remove([doc.storage_path]);
  if (doc.drive_file_id) {
    try {
      await deleteDriveFile(doc.drive_file_id);
    } catch {
      /* best-effort */
    }
  }
  await logEvent(admin, {
    loanId,
    actorId: user.id,
    eventType: "document_deleted",
    payload: { file_name: doc.file_name },
  });

  return Response.json({ ok: true });
}
