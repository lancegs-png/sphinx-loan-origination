import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { buildLoiTemplateData } from "@/lib/term-sheet/data";
import { fillDocx } from "@/lib/templates/docx";
import { docxToPdf } from "@/lib/templates/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The borrower-facing Letter of Intent is the Word template (dscr_loi.docx) filled
// with the loan's terms and rendered to PDF via LibreOffice — the same document the
// lending team sees in the Templates tab.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Access check runs under the caller's RLS; null means no access to this loan.
  const { data: loanRow } = await supabase.from("loans").select("id").eq("id", id).single();
  if (!loanRow) return new Response("Not found", { status: 404 });

  // Assemble the LOI with the service-role client so the borrower-facing terms are
  // complete (the LOI template exposes only borrower-facing fields by design).
  const built = await buildLoiTemplateData(createServiceRoleClient(), id);
  if (!built) return new Response("Not found", { status: 404 });

  try {
    const docx = fillDocx("dscr_loi", built.map);
    const pdf = await docxToPdf(docx);
    const filename = `Letter of Intent - ${built.loanNumber}${built.signed ? " (signed)" : ""}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "PDF export failed.", { status: 503 });
  }
}
