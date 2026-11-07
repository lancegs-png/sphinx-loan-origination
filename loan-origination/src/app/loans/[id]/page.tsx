import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadFieldValues } from "@/lib/fields";
import { loadLoanChecklist } from "@/lib/checklist";
import { DealView } from "@/components/deal-view";
import type { ChecklistItem, FieldDef, InternalNote, Loan, Message, Participant } from "@/lib/types";

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

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("loan_id", id)
    .order("created_at", { ascending: true });

  const { data: participants } = await supabase
    .from("deal_participants")
    .select("*, profiles(*)")
    .eq("loan_id", id);

  const internalNotes: InternalNote[] = isLender
    ? ((
        await supabase
          .from("internal_notes")
          .select("*")
          .eq("loan_id", id)
          .order("created_at", { ascending: true })
      ).data as InternalNote[]) ?? []
    : [];

  const { data: fieldDefs } = await supabase
    .from("field_definitions")
    .select("key,label,section,type,options,lender_only,sort,verifiable,repeat_group,source,required_stage,calc_key")
    .order("sort");

  // Current field values (RLS filters lender-only fields for borrowers).
  const fieldValues = await loadFieldValues(supabase, id);

  const typedLoan = loan as Loan;
  const checklist = await loadLoanChecklist(supabase, id, typedLoan.program_id);
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
      fieldDefs={(fieldDefs as FieldDef[]) ?? []}
      fieldValues={fieldValues}
      checklist={checklist}
      atProcessing={atProcessing}
    />
  );
}
