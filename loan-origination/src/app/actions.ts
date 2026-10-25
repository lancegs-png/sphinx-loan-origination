"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { answerLoanQuestion } from "@/lib/ai/record-keeper";

/**
 * Add Loan (R-UI-11): a lending-team user starts a new loan, which opens its chat.
 * Full conversational intake is a later phase (P6); M1 creates the deal shell and
 * seeds an opening message so the chat is ready.
 */
export async function addLoan() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();

  const { data: loan, error } = await supabase
    .from("loans")
    .insert({
      created_by: user.id,
      account_manager_id:
        profile?.lender_user_type === "account_manager" ? user.id : null,
      stage: "intake",
    })
    .select("id")
    .single();

  if (error || !loan) throw new Error(error?.message ?? "Failed to create loan");

  await supabase.from("deal_participants").insert({
    loan_id: loan.id,
    user_id: user.id,
    participant_role: "lending_team",
    added_by: user.id,
  });

  await supabase.from("messages").insert({
    loan_id: loan.id,
    sender_kind: "system",
    sender_role: "system",
    body: "New loan started. Let’s begin intake — who is the borrower, and what are they looking to finance?",
  });

  redirect(`/loans/${loan.id}`);
}

/**
 * Ask the AI record keeper a question about a loan (R-CHAT-6).
 * Retrieval runs as the caller (RLS-enforced); the AI reply is persisted as a
 * system-authored 'ai' message so it streams to all participants via realtime.
 * Returns { ok, error } — the caller's question is posted separately by the chat UI.
 */
export async function askAi(
  loanId: string,
  question: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_lending_team")
    .eq("id", user.id)
    .single();
  const isLender = !!profile?.is_lending_team;

  let answer: string | null;
  try {
    answer = await answerLoanQuestion({ supabase, loanId, question, isLender });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }

  // null = caller has no access to this loan; do not persist anything.
  if (answer === null) return { ok: false, error: "No access to this loan." };

  // System write of the AI reply (retrieval above was user-scoped; see §5.1).
  // CRITICAL: a lender's answer may draw on internal notes/trade data, so it must
  // be marked internal (team-only). A borrower/originator answer has no internal
  // data in it (RLS excluded it from retrieval) and stays shared.
  const admin = createServiceRoleClient();
  const { error } = await admin.from("messages").insert({
    loan_id: loanId,
    sender_kind: "ai",
    sender_role: "ai",
    is_internal: isLender,
    body: answer,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
