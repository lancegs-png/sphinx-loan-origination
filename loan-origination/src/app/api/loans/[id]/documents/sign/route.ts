import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "loan-documents";

/**
 * Issue a short-lived signed URL so the browser can upload a document straight to Storage,
 * bypassing the serverless request-size limit (large scanned leases etc.). The bytes never
 * pass through this function. Lending team + loan access required; the upload path is pinned
 * under the loan's folder. The caller then POSTs the returned `path` to the documents route
 * to record + mirror the file.
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
  const { data: loan } = await supabase.from("loans").select("id").eq("id", loanId).single();
  if (!loan) return new Response("Not found", { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { fileName?: string };
  const safe = String(body.fileName ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${loanId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return new Response(error?.message ?? "Could not sign upload", { status: 500 });

  return Response.json({ path: data.path, token: data.token });
}
