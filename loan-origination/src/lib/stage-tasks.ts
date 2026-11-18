import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STAGE_BUCKETS } from "@/lib/stages";
import type { StageTaskGroup } from "@/lib/types";

/**
 * Load a loan's stage-task checklist: the program's current task templates grouped by
 * pipeline bucket, left-joined with this loan's completion state. Template-driven — there
 * is no per-loan materialization, so editing a program's tasks reflects on every loan at
 * once, and completion is stored per template task id. User-scoped client → RLS: the
 * templates are lending-team-only, so borrowers get nothing (empty list → no tab content).
 */
export async function loadLoanStageTasks(
  client: SupabaseClient,
  loanId: string,
  programId: string | null,
): Promise<StageTaskGroup[]> {
  if (!programId) return [];

  const [{ data: tasks }, { data: status }] = await Promise.all([
    client
      .from("program_stage_tasks")
      .select("id,stage_bucket,label,sort")
      .eq("program_id", programId)
      .order("sort"),
    client
      .from("loan_task_status")
      .select("task_id,done,note,completed_at,prof:completed_by(full_name,email)")
      .eq("loan_id", loanId),
  ]);
  if (!tasks?.length) return [];

  const stat = new Map(
    (status ?? []).map((s) => {
      // A to-one FK embed returns a single row at runtime, but the generated types widen
      // it to an array — normalize both shapes.
      const raw = s.prof as unknown as
        | { full_name: string | null; email: string | null }
        | { full_name: string | null; email: string | null }[]
        | null;
      const prof = Array.isArray(raw) ? (raw[0] ?? null) : raw;
      return [
        s.task_id as string,
        {
          done: (s.done as boolean) ?? false,
          note: (s.note as string | null) ?? null,
          completedAt: (s.completed_at as string | null) ?? null,
          completedBy: prof?.full_name || prof?.email || null,
        },
      ];
    }),
  );

  return STAGE_BUCKETS.map((b) => ({
    bucketKey: b.key,
    bucketLabel: b.label,
    tasks: tasks
      .filter((t) => t.stage_bucket === b.key)
      .map((t) => {
        const s = stat.get(t.id);
        return {
          id: t.id,
          label: t.label,
          done: s?.done ?? false,
          note: s?.note ?? null,
          completedBy: s?.completedBy ?? null,
          completedAt: s?.completedAt ?? null,
        };
      }),
  })).filter((g) => g.tasks.length > 0);
}
