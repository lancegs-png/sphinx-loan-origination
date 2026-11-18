import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "loan-documents";

/**
 * Admin-only: issue a short-lived signed URL so the browser can upload a sizer workbook straight
 * to Storage, bypassing the serverless request-size limit (the Eastview sizer is ~14MB; Vercel
 * caps function request bodies at 4.5MB). The bytes never pass through a function. The caller then
 * POSTs the returned `path` to the parse route, which downloads + parses it server-side and
 * deletes the temp object. Uploads live under a `pricing-uploads/` prefix in the shared private
 * bucket so no new bucket provisioning is needed.
 */
export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();
  if (me?.lender_user_type !== "admin")
    return Response.json({ ok: false, error: "Admins only." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { fileName?: string };
  const safe = String(body.fileName ?? "sizer.xlsx").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `pricing-uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data)
    return Response.json({ ok: false, error: error?.message ?? "Could not sign upload." }, { status: 500 });

  return Response.json({ ok: true, path: data.path, token: data.token });
}
