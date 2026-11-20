import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadFieldValues } from "@/lib/fields";
import { loadLoanChecklist, loadLoanDocuments } from "@/lib/checklist";
import { loadLoanStageTasks } from "@/lib/stage-tasks";
import { loadLoanActivity, type ActivityEvent } from "@/lib/audit";
import { DealView } from "@/components/deal-view";
import type { FieldDef, FieldValues, InternalNote, Loan, Message, Participant } from "@/lib/types";

/**
 * Whether a field applies to a loan's program. A field with no program scope applies
 * everywhere; otherwise it applies when it names the loan's program key. A field that
 * already holds a value is always kept so a reclassified loan never hides entered data,
 * and when the program is unknown nothing is filtered.
 */
function fieldAppliesToProgram(def: FieldDef, programKey: string | null, values: FieldValues): boolean {
  if (!def.programs || def.programs.length === 0) return true;
  if (!programKey) return true;
  if (def.programs.includes(programKey)) return true;
  for (const k of Object.keys(values)) {
    if (k === def.key || k.startsWith(`${def.key}#`)) {
      const cur = values[k]?.current;
      if (cur !== null && cur !== undefined && cur !== "") return true;
    }
  }
  return false;
}

// AI chat (Ask AI / intake) runs as Server Actions from this page. Give them headroom
// beyond the platform's short default so a model reply can't be cut off mid-generation.
export const maxDuration = 60;

const STAGE_ORDER = [
  "intake", "pre_qualification", "quote_term_sheet", "processing",
  "underwriting", "final_approval", "closing", "post_close",
];

export default async function LoanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const { userId, profile } = session;
  if (!profile) redirect("/login");
  const isLender = profile.is_lending_team;

  const supabase = await createClient();

  // RLS returns the row only if this user has access to the loan.
  const { data: loan } = await supabase.from("loans").select("*").eq("id", id).single();
  if (!loan) notFound();
  const typedLoan = loan as Loan;

  // The rest of the deal's data is independent (only the checklist needs the loan's
  // program), so fetch it in one parallel wave instead of ~8 sequential round-trips —
  // this is what makes page loads and refreshes (e.g. a stage change) feel snappy.
  const [messagesRes, participantsRes, internalNotes, fieldDefsRes, fieldValues, checklist, stageTasks, documents, activity, programKey] =
    await Promise.all([
      supabase.from("messages").select("*").eq("loan_id", id).order("created_at", { ascending: true }),
      supabase.from("deal_participants").select("*, profiles(*)").eq("loan_id", id),
      isLender
        ? supabase
            .from("internal_notes")
            .select("*, author:author_id(full_name,email)")
            .eq("loan_id", id)
            .order("created_at", { ascending: true })
            .then((r) => (r.data as InternalNote[]) ?? [])
        : Promise.resolve([] as InternalNote[]),
      supabase
        .from("field_definitions")
        .select("key,label,section,type,options,lender_only,sort,verifiable,repeat_group,source,required_stage,calc_key,programs")
        .order("sort"),
      loadFieldValues(supabase, id), // RLS filters lender-only fields for borrowers
      loadLoanChecklist(supabase, id, typedLoan.program_id),
      // Stage-task checklist is an internal-staff tab; skip the query for borrowers.
      isLender
        ? loadLoanStageTasks(supabase, id, typedLoan.program_id)
        : Promise.resolve([] as Awaited<ReturnType<typeof loadLoanStageTasks>>),
      loadLoanDocuments(supabase, id),
      // Activity log is a lender-only tab; load it only for the lending team.
      isLender ? loadLoanActivity(supabase, id) : Promise.resolve([] as ActivityEvent[]),
      // The loan's program key (loan_type_key) scopes which data fields apply.
      typedLoan.program_id
        ? supabase
            .from("loan_programs")
            .select("loan_type_key")
            .eq("id", typedLoan.program_id)
            .single()
            .then((r) => (r.data?.loan_type_key as string | null) ?? null)
        : Promise.resolve(null),
    ]);

  const messages = messagesRes.data;
  const participants = participantsRes.data;
  const allFieldDefs = (fieldDefsRes.data as FieldDef[]) ?? [];
  // Labels cover every field (the activity log references fields outside this program too).
  const fieldLabels = Object.fromEntries(allFieldDefs.map((d) => [d.key, d.label]));
  // The loan grid shows only the fields that apply to this loan's program (plus any that
  // already hold data, so a reclassified loan never hides values the team entered).
  const fieldDefs = allFieldDefs.filter((d) => fieldAppliesToProgram(d, programKey, fieldValues));
  const atProcessing = STAGE_ORDER.indexOf(typedLoan.stage) >= STAGE_ORDER.indexOf("processing");

  const parts = (participants as Participant[]) ?? [];
  const myRole =
    parts.find((p) => p.user_id === userId)?.participant_role ??
    (isLender ? "lending_team" : "borrower");

  return (
    <DealView
      loan={loan as Loan}
      messages={(messages as Message[]) ?? []}
      participants={parts}
      internalNotes={internalNotes}
      currentUserId={userId}
      currentRole={myRole}
      isLender={isLender}
      intakeMode={(loan as Loan).stage === "intake"}
      fieldDefs={fieldDefs}
      fieldValues={fieldValues}
      checklist={checklist}
      stageTasks={stageTasks}
      documents={documents}
      activity={activity}
      fieldLabels={fieldLabels}
      atProcessing={atProcessing}
    />
  );
}
