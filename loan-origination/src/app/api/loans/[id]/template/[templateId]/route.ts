import { createClient } from "@/lib/supabase/server";
import { assembleTermSheetData } from "@/lib/term-sheet/data";
import { renderTermSheetPdf } from "@/lib/term-sheet/document";
import { TEMPLATES } from "@/lib/templates/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { id, templateId } = await params;
  const def = TEMPLATES.find((t) => t.id === templateId);
  if (!def || !def.generatable) return new Response("Template not available", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const assembled = await assembleTermSheetData(supabase, id); // RLS: null if no access
  if (!assembled) return new Response("Not found", { status: 404 });

  // DSCR LOI. (Served as PDF for now; .docx fill is the next increment.)
  const pdf = await renderTermSheetPdf(assembled.data);
  const street = (assembled.data.propertyAddress || assembled.loanNumber).split(",")[0].trim();
  const filename = `${def.name} - ${street}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
