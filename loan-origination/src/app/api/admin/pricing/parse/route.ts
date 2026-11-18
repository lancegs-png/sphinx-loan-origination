import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { parseEastview } from "@/lib/pricing/parse-eastview";
import { parseDeephaven } from "@/lib/pricing/parse-deephaven";
import { buildPreview } from "@/lib/pricing/preview";
import type { InvestorFamily } from "@/lib/pricing/general";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "loan-documents";

/**
 * Admin-only: parse an uploaded investor "sizer" workbook into a pricing engine config and
 * return it plus a human-checkable preview — WITHOUT saving. The admin reviews the preview and
 * then publishes via the publishInvestorPricing server action.
 *
 * The browser first uploads the workbook straight to Storage via a signed URL (see ../sign) —
 * Vercel caps function request bodies at 4.5MB and the Eastview sizer is ~14MB, so the bytes must
 * not flow through this function. The client hands us only the `storagePath`; we download it
 * server-side (no body cap), parse the small pricing tabs by streaming, delete the temp object,
 * and return the preview. The original name is passed through for the engine's source_file label.
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

  const body = (await req.json().catch(() => null)) as {
    investor?: string;
    storagePath?: string;
    fileName?: string;
  } | null;
  const investor = String(body?.investor ?? "") as InvestorFamily;
  const storagePath = String(body?.storagePath ?? "");
  const fileName = String(body?.fileName ?? "sizer.xlsx");
  if (investor !== "eastview" && investor !== "deephaven")
    return Response.json({ ok: false, error: "Unknown investor." }, { status: 400 });
  if (!storagePath.startsWith("pricing-uploads/"))
    return Response.json({ ok: false, error: "No upload provided." }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath);
  if (dlErr || !blob)
    return Response.json(
      { ok: false, error: dlErr?.message ?? "Uploaded file not found." },
      { status: 404 },
    );
  const buffer = Buffer.from(await blob.arrayBuffer());

  try {
    const engine =
      investor === "eastview"
        ? await parseEastview(buffer, fileName)
        : await parseDeephaven(buffer, fileName);
    return Response.json({ ok: true, investor, engine, preview: buildPreview(engine) });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not parse this workbook." },
      { status: 422 },
    );
  } finally {
    // Temp upload — best-effort cleanup so the bucket doesn't accumulate sizers.
    await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  }
}
