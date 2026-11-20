"use server";

import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseProgramConfig, type ParsedDocument, type ParsedTask } from "@/lib/program-config/parse";

const VALID_STAGES = new Set([
  "intake",
  "pre_qualification",
  "quote_term_sheet",
  "onboarding",
  "processing",
  "underwriting",
  "final_approval",
  "closing",
  "post_close",
]);

export type ImportSummary = {
  fields: { total: number; new: number };
  documents: { total: number; new: number; memberships: number };
  tasks: { total: number; memberships: number };
  programs: { matched: string[]; unknown: string[] };
  warnings: string[];
};

export type ImportResult = { ok: boolean; error?: string; applied: boolean; summary?: ImportSummary };

/**
 * Admin: import a Program Configuration workbook (Loan Data / Documents / Tasks tabs). Call
 * once with dryRun to preview the diff, then again without to apply. Applying is a deliberate
 * overwrite: field definitions and document types are upserted by key (never deleted), and
 * each program's document + task membership is reconciled to exactly the sheet's toggles.
 * Per-loan values/statuses survive because they key off the stable field/document/task identity.
 * Uses the admin's own session — every target table has an is_admin() write policy.
 */
export async function importProgramConfig(formData: FormData): Promise<ImportResult> {
  const session = await getSessionProfile();
  if (session?.profile?.lender_user_type !== "admin") {
    return { ok: false, applied: false, error: "Admins only." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, applied: false, error: "Choose a .xlsx file to import." };
  }
  const dryRun = formData.get("dryRun") === "1";

  let parsed;
  try {
    parsed = await parseProgramConfig(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, applied: false, error: e instanceof Error ? e.message : "Could not read the workbook." };
  }

  const sb = await createClient();
  const warnings = [...parsed.warnings];

  // Resolve the sheet's program keys to loan_programs rows.
  const { data: progRows } = await sb.from("loan_programs").select("id,loan_type_key");
  const progByKey = new Map<string, string>(
    (progRows ?? []).map((p) => [String(p.loan_type_key), p.id as string]),
  );
  const usedKeys = new Set<string>();
  for (const d of parsed.documents) d.programs.forEach((k) => usedKeys.add(k));
  for (const t of parsed.tasks) t.programs.forEach((k) => usedKeys.add(k));
  for (const f of parsed.fields) f.programs.forEach((k) => usedKeys.add(k));
  const matched = [...usedKeys].filter((k) => progByKey.has(k));
  const unknown = [...usedKeys].filter((k) => !progByKey.has(k));
  if (unknown.length) warnings.push(`No program row for: ${unknown.join(", ")} — those columns are ignored.`);

  // ---- Preview counts ----
  const { data: existingFields } = await sb.from("field_definitions").select("key");
  const existingFieldKeys = new Set((existingFields ?? []).map((r) => String(r.key)));
  const { data: existingDocs } = await sb.from("document_types").select("key");
  const existingDocKeys = new Set((existingDocs ?? []).map((r) => String(r.key)));

  const summary: ImportSummary = {
    fields: {
      total: parsed.fields.length,
      new: parsed.fields.filter((f) => !existingFieldKeys.has(f.key)).length,
    },
    documents: {
      total: parsed.documents.length,
      new: parsed.documents.filter((d) => !existingDocKeys.has(d.key)).length,
      memberships: parsed.documents.reduce(
        (n, d) => n + d.programs.filter((k) => progByKey.has(k)).length,
        0,
      ),
    },
    tasks: {
      total: parsed.tasks.length,
      memberships: parsed.tasks.reduce((n, t) => n + t.programs.filter((k) => progByKey.has(k)).length, 0),
    },
    programs: { matched, unknown },
    warnings,
  };

  if (dryRun) return { ok: true, applied: false, summary };

  // ---- Apply: fields ----
  if (parsed.fields.length) {
    const rows = parsed.fields.map((f, i) => {
      const stage = f.requiredStage && VALID_STAGES.has(f.requiredStage) ? f.requiredStage : null;
      if (f.requiredStage && !stage) warnings.push(`Field "${f.key}": unknown stage "${f.requiredStage}" — left blank.`);
      return {
        key: f.key,
        label: f.label,
        section: f.section,
        type: f.type,
        options: f.options,
        source: f.source,
        required_stage: stage,
        repeat_group: f.repeatGroup,
        lender_only: f.lenderOnly,
        // all 7 checked ⇒ "applies to all" ⇒ empty array (the existing convention)
        programs: f.allPrograms ? [] : f.programs,
        sort: (i + 1) * 10,
      };
    });
    const { error } = await sb.from("field_definitions").upsert(rows, { onConflict: "key" });
    if (error) return { ok: false, applied: false, error: `Fields: ${error.message}` };
  }

  // ---- Apply: documents (upsert types, then reconcile per-program membership) ----
  const docIdByKey = new Map<string, string>();
  if (parsed.documents.length) {
    // document_types is uniquely constrained on BOTH key and name. Reconcile each parsed doc
    // against the existing library by key first, then by name — so a name that already exists
    // under a different key reuses that row instead of violating the name unique constraint.
    const { data: existingTypes } = await sb.from("document_types").select("id,key,name");
    const byKey = new Map<string, { id: string; name: string }>();
    const byName = new Map<string, string>(); // lowercased name -> id
    for (const t of existingTypes ?? []) {
      byKey.set(String(t.key), { id: t.id as string, name: String(t.name ?? "") });
      if (t.name) byName.set(String(t.name).toLowerCase(), t.id as string);
    }

    for (const d of parsed.documents) {
      const nameLc = d.name.toLowerCase();
      const keyRow = byKey.get(d.key);
      if (keyRow) {
        // Row exists for this key. Update guidance; rename only when the new name isn't already
        // taken by a different row (which would trip the name unique constraint).
        const nameOwner = byName.get(nameLc);
        const canRename = keyRow.name.toLowerCase() !== nameLc && (!nameOwner || nameOwner === keyRow.id);
        const patch: Record<string, unknown> = { default_review_rules: d.guidance };
        if (canRename) patch.name = d.name;
        const { error } = await sb.from("document_types").update(patch).eq("id", keyRow.id);
        if (error) return { ok: false, applied: false, error: `Document types: ${error.message}` };
        docIdByKey.set(d.key, keyRow.id);
        if (canRename) {
          byName.delete(keyRow.name.toLowerCase());
          byName.set(nameLc, keyRow.id);
          keyRow.name = d.name;
        }
        continue;
      }
      const nameId = byName.get(nameLc);
      if (nameId) {
        // Same name already exists under a different key — reuse that type.
        const { error } = await sb.from("document_types").update({ default_review_rules: d.guidance }).eq("id", nameId);
        if (error) return { ok: false, applied: false, error: `Document types: ${error.message}` };
        docIdByKey.set(d.key, nameId);
        continue;
      }
      // New type.
      const { data: ins, error } = await sb
        .from("document_types")
        .insert({ key: d.key, name: d.name, default_review_rules: d.guidance })
        .select("id")
        .single();
      if (error || !ins) {
        return { ok: false, applied: false, error: `Document types: ${error?.message ?? "insert failed"}` };
      }
      docIdByKey.set(d.key, ins.id as string);
      byKey.set(d.key, { id: ins.id as string, name: d.name });
      byName.set(nameLc, ins.id as string);
    }
  }

  for (const key of matched) {
    const programId = progByKey.get(key)!;
    const wanted = parsed.documents
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.programs.includes(key) && docIdByKey.has(d.key));
    const wantedIds = new Set(wanted.map(({ d }) => docIdByKey.get(d.key)!));

    const { data: existing } = await sb
      .from("program_checklist_items")
      .select("document_type_id")
      .eq("program_id", programId);
    const toDelete = (existing ?? [])
      .map((r) => String(r.document_type_id))
      .filter((id) => !wantedIds.has(id));
    if (toDelete.length) {
      const { error } = await sb
        .from("program_checklist_items")
        .delete()
        .eq("program_id", programId)
        .in("document_type_id", toDelete);
      if (error) return { ok: false, applied: false, error: `Checklist (${key}): ${error.message}` };
    }
    if (wanted.length) {
      const rows = wanted.map(({ d, i }: { d: ParsedDocument; i: number }) => ({
        program_id: programId,
        document_type_id: docIdByKey.get(d.key)!,
        required: d.required,
        assignee: d.assignee,
        category: d.category,
        visibility: d.visibility,
        sort: (i + 1) * 10,
      }));
      const { error } = await sb
        .from("program_checklist_items")
        .upsert(rows, { onConflict: "program_id,document_type_id" });
      if (error) return { ok: false, applied: false, error: `Checklist (${key}): ${error.message}` };
    }
  }

  // ---- Apply: tasks (reconcile per-program, matching on bucket+label to keep ids) ----
  for (const key of matched) {
    const programId = progByKey.get(key)!;
    const wanted: ParsedTask[] = parsed.tasks.filter((t) => t.programs.includes(key));
    const err = await reconcileTasks(sb, programId, wanted);
    if (err) return { ok: false, applied: false, error: `Tasks (${key}): ${err}` };
  }

  summary.warnings = warnings;
  return { ok: true, applied: true, summary };
}

type DbClient = Awaited<ReturnType<typeof createClient>>;

/** Reconcile one program's stage tasks to `wanted`, reusing existing rows by (bucket,label)
 *  so per-loan completion (loan_task_status, keyed by task id) survives. */
async function reconcileTasks(sb: DbClient, programId: string, wanted: ParsedTask[]): Promise<string | null> {
  const { data: existing } = await sb
    .from("program_stage_tasks")
    .select("id,stage_bucket,label")
    .eq("program_id", programId);
  const byNatural = new Map<string, string>();
  for (const row of existing ?? []) {
    byNatural.set(`${row.stage_bucket}\u0000${row.label}`, row.id as string);
  }

  const counters: Record<string, number> = {};
  const keep = new Set<string>();
  const inserts: {
    program_id: string;
    stage_bucket: string;
    label: string;
    sort: number;
    visibility: string;
    assigned_to: string | null;
  }[] = [];
  const updates: { id: string; sort: number; visibility: string; assigned_to: string | null }[] = [];

  for (const t of wanted) {
    const sort = counters[t.stageBucket] ?? 0;
    counters[t.stageBucket] = sort + 1;
    const id = byNatural.get(`${t.stageBucket}\u0000${t.label}`);
    if (id) {
      keep.add(id);
      updates.push({ id, sort, visibility: t.visibility, assigned_to: t.assignedTo });
    } else {
      inserts.push({
        program_id: programId,
        stage_bucket: t.stageBucket,
        label: t.label,
        sort,
        visibility: t.visibility,
        assigned_to: t.assignedTo,
      });
    }
  }

  const toDelete = [...byNatural.values()].filter((id) => !keep.has(id));
  if (toDelete.length) {
    const { error } = await sb.from("program_stage_tasks").delete().in("id", toDelete);
    if (error) return error.message;
  }
  for (const u of updates) {
    const { error } = await sb
      .from("program_stage_tasks")
      .update({ sort: u.sort, visibility: u.visibility, assigned_to: u.assigned_to })
      .eq("id", u.id);
    if (error) return error.message;
  }
  if (inserts.length) {
    const { error } = await sb.from("program_stage_tasks").insert(inserts);
    if (error) return error.message;
  }
  return null;
}
