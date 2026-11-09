import { createClient } from "@/lib/supabase/server";
import { loadLoanActivity } from "@/lib/audit";
import { describeEvent, actorName } from "@/lib/activity";
import { htmlToPdf, pdfConversionAvailable } from "@/lib/templates/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Download the full activity history for a loan as a PDF log. Lending team only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  const { data: loan } = await supabase
    .from("loans")
    .select("loan_number,opportunity_number,property_address")
    .eq("id", id)
    .single();
  if (!loan) return new Response("Not found", { status: 404 });
  const ref = String(loan.loan_number ?? loan.opportunity_number ?? id);

  if (!(await pdfConversionAvailable())) {
    return new Response("PDF export needs LibreOffice installed on the server.", { status: 503 });
  }

  const events = await loadLoanActivity(supabase, id); // RLS: lender sees all
  const { data: defs } = await supabase.from("field_definitions").select("key,label");
  const labels = Object.fromEntries((defs ?? []).map((d) => [d.key, d.label as string]));
  const labelFor = (k: string) => labels[k] ?? k;

  // Oldest-first reads as a history.
  const rows = events
    .slice()
    .reverse()
    .map(
      (e) => `<tr>
        <td>${esc(new Date(e.created_at).toLocaleString("en-US"))}</td>
        <td>${esc(describeEvent(e, labelFor))}</td>
        <td>${esc(actorName(e))}${e.is_internal ? " (internal)" : ""}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#10151d;}
    h1{font-size:15pt;margin:0 0 2pt;}
    .sub{color:#555;font-size:9pt;margin:0 0 12pt;}
    table{border-collapse:collapse;width:100%;}
    th,td{border:1px solid #ccc;padding:4pt 6pt;text-align:left;vertical-align:top;}
    th{background:#f2efe9;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;}
    td{font-size:9pt;}
  </style></head><body>
    <h1>Activity Log &mdash; ${esc(ref)}</h1>
    <p class="sub">${esc(loan.property_address ?? "")} &middot; Generated ${esc(
      new Date().toLocaleString("en-US"),
    )} &middot; ${events.length} events</p>
    <table>
      <thead><tr><th>Timestamp</th><th>Activity</th><th>By</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">No activity recorded.</td></tr>'}</tbody>
    </table>
  </body></html>`;

  const pdf = await htmlToPdf(html);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Activity Log - ${ref}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
