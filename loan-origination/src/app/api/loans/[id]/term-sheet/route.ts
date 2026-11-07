import { createClient } from "@/lib/supabase/server";
import { assembleTermSheetData } from "@/lib/term-sheet/data";
import { renderTermSheetPdf } from "@/lib/term-sheet/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const assembled = await assembleTermSheetData(supabase, id); // RLS: null if no access
  if (!assembled) return new Response("Not found", { status: 404 });

  const pdf = await renderTermSheetPdf(assembled.data);
  const filename = `Term Sheet - ${assembled.loanNumber}${assembled.data.signature ? " (signed)" : ""}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
