import { createClient } from "@/lib/supabase/server";
import { parseEastview } from "@/lib/pricing/parse-eastview";
import { parseDeephaven } from "@/lib/pricing/parse-deephaven";
import { buildPreview } from "@/lib/pricing/preview";
import type { InvestorFamily } from "@/lib/pricing/general";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Admin-only: parse an uploaded investor "sizer" workbook into a pricing engine config and
 * return it plus a human-checkable preview — WITHOUT saving. The admin reviews the preview and
 * then publishes via the publishInvestorPricing server action. A Route Handler (not a server
 * action) because the Eastview sizer is ~14MB and server actions cap bodies at 1MB; parsing
 * streams the workbook so only the small pricing tabs are held in memory.
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
  }
  const investor = String(form.get("investor") ?? "") as InvestorFamily;
  const file = form.get("file");
  if (investor !== "eastview" && investor !== "deephaven")
    return Response.json({ ok: false, error: "Unknown investor." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0)
    return Response.json({ ok: false, error: "No file provided." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const engine =
      investor === "eastview"
        ? await parseEastview(buffer, file.name)
        : await parseDeephaven(buffer, file.name);
    return Response.json({ ok: true, investor, engine, preview: buildPreview(engine) });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not parse this workbook." },
      { status: 422 },
    );
  }
}
