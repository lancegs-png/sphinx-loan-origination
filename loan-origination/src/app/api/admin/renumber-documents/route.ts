import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { indexedName, fileExt } from "@/lib/documents/naming";
import { renameDriveFile } from "@/lib/google/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops-only: fix a loan's documents that were uploaded before the per-type numbering
 * counted existing files — i.e. multiple docs of one type that share the same name. Within
 * each checklist item (ordered by upload time) the first keeps the base name and the rest
 * become "<base> 2", "<base> 3", …, renaming both the DB row and the Drive file. Idempotent.
 * Service role, gated by SHEETS_SYNC_SECRET.
 */
function secretOk(given: string): boolean {
  const expected = process.env.SHEETS_SYNC_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const stripExt = (name: string): string => {
  const e = fileExt(name);
  return e ? name.slice(0, -e.length) : name;
};

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  const ref = String(body.loanNumber ?? body.opportunityNumber ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!ref) return new Response("Missing loanNumber", { status: 400 });

  const admin = createServiceRoleClient();
  const { data: loan } = await admin
    .from("loans")
    .select("id,loan_number,opportunity_number")
    .or(`loan_number.eq.${ref},opportunity_number.eq.${ref}`)
    .maybeSingle();
  if (!loan) return Response.json({ ok: false, error: "loan not found" }, { status: 404 });

  const { data: docs } = await admin
    .from("loan_documents")
    .select("id,checklist_item_id,file_name,drive_file_id,created_at")
    .eq("loan_id", loan.id)
    .order("created_at", { ascending: true });

  // Group by checklist item (the document-type slot). Unassigned uploads keep their names.
  const groups = new Map<string, typeof docs>();
  for (const d of docs ?? []) {
    if (!d.checklist_item_id) continue;
    const arr = groups.get(d.checklist_item_id) ?? [];
    arr.push(d);
    groups.set(d.checklist_item_id, arr);
  }

  const renamed: { from: string; to: string }[] = [];
  for (const arr of groups.values()) {
    if (!arr || arr.length < 2) continue; // only multi-doc types can collide
    const base = stripExt(arr[0].file_name); // earliest = the un-numbered base
    for (let i = 0; i < arr.length; i++) {
      const want = indexedName(base, i, fileExt(arr[i].file_name));
      if (want === arr[i].file_name) continue;
      await admin.from("loan_documents").update({ file_name: want }).eq("id", arr[i].id);
      if (arr[i].drive_file_id) {
        try {
          await renameDriveFile(arr[i].drive_file_id as string, want);
        } catch {
          /* best-effort: DB name is the source of truth for the UI */
        }
      }
      renamed.push({ from: arr[i].file_name, to: want });
    }
  }

  return Response.json({
    ok: true,
    loan: loan.loan_number ?? loan.opportunity_number,
    renamed,
  });
}
