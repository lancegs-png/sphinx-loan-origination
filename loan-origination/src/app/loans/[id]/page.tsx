import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DealView } from "@/components/deal-view";
import type { InternalNote, Loan, Message, Participant } from "@/lib/types";

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
    />
  );
}
