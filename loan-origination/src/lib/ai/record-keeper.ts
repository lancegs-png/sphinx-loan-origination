import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stageLabel } from "@/lib/stages";

// Default to the current Claude model; overridable via env.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

/**
 * The AI "record keeper & originator" (design §6).
 *
 * SECURITY (design §5.1): retrieval runs through the caller's **user-scoped**
 * Supabase client, so RLS filters the context. A borrower's context physically
 * cannot contain internal notes or internal messages — the model can't reveal
 * what it never received.
 *
 * Returns the answer text, or null if the caller has no access to the loan.
 */
export async function answerLoanQuestion(opts: {
  supabase: SupabaseClient;
  loanId: string;
  question: string;
  isLender: boolean;
}): Promise<string | null> {
  const { supabase, loanId, question, isLender } = opts;

  const { data: loan } = await supabase
    .from("loans")
    .select(
      "loan_number,stage,status,loan_type,loan_amount,property_address,borrower_name,expected_close_date,program_id",
    )
    .eq("id", loanId)
    .single();

  // RLS returns null when the caller isn't a participant — no access, no answer.
  if (!loan) return null;

  const [{ data: program }, { data: messages }, notesResult] = await Promise.all([
    loan.program_id
      ? supabase.from("loan_programs").select("name,public_info").eq("id", loan.program_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("messages")
      .select("sender_role,sender_kind,is_internal,body,created_at")
      .eq("loan_id", loanId)
      .order("created_at", { ascending: true })
      .limit(40),
    isLender
      ? supabase.from("internal_notes").select("body,created_at").eq("loan_id", loanId)
      : Promise.resolve({ data: [] as { body: string; created_at: string }[] }),
  ]);

  const context = buildContext({
    loan,
    program: program as { name: string; public_info: string | null } | null,
    messages: (messages as ConvMessage[]) ?? [],
    notes: (notesResult.data as { body: string }[]) ?? [],
    isLender,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt(isLender),
    messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
  });

  if (response.stop_reason === "refusal") {
    return "I'm not able to answer that.";
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return text || "I don't have that information in this loan's record.";
}

type ConvMessage = {
  sender_role: string | null;
  sender_kind: string;
  is_internal: boolean;
  body: string;
  created_at: string;
};

function systemPrompt(isLender: boolean): string {
  const base = [
    "You are the AI System for a private loan origination platform (you appear as \"AI System\" in the chat).",
    "Answer questions about this specific loan concisely and accurately, using ONLY the loan context provided.",
    "If the answer is not in the context, say you don't have that information rather than guessing.",
    "Do not invent amounts, dates, rates, or statuses.",
  ];
  if (isLender) {
    base.push(
      "You are speaking with a member of the lending team; you may reference internal notes and trade data included in the context.",
    );
  } else {
    base.push(
      "You are speaking with the borrower or their originator. Never reveal internal lender notes, trade terms, or confidential information. Only the context you were given is available to you.",
    );
  }
  return base.join(" ");
}

function money(n: number | null): string {
  return n == null ? "unknown" : `$${n.toLocaleString()}`;
}

function buildContext(args: {
  loan: {
    loan_number: string;
    stage: string;
    status: string;
    loan_type: string | null;
    loan_amount: number | null;
    property_address: string | null;
    borrower_name: string | null;
    expected_close_date: string | null;
  };
  program: { name: string; public_info: string | null } | null;
  messages: ConvMessage[];
  notes: { body: string }[];
  isLender: boolean;
}): string {
  const { loan, program, messages, notes, isLender } = args;

  const lines: string[] = [];
  lines.push("=== LOAN RECORD ===");
  lines.push(`Loan number: ${loan.loan_number}`);
  lines.push(`Stage: ${stageLabel(loan.stage)}`);
  lines.push(`Status: ${loan.status}`);
  lines.push(`Loan type: ${loan.loan_type ?? "unknown"}`);
  lines.push(`Loan amount: ${money(loan.loan_amount)}`);
  lines.push(`Property: ${loan.property_address ?? "unknown"}`);
  lines.push(`Borrower: ${loan.borrower_name ?? "unknown"}`);
  lines.push(`Expected closing: ${loan.expected_close_date ?? "unknown"}`);

  if (program) {
    lines.push("");
    lines.push("=== PROGRAM ===");
    lines.push(`Program: ${program.name}`);
    if (program.public_info) lines.push(program.public_info);
  }

  if (messages.length) {
    lines.push("");
    lines.push("=== RECENT CONVERSATION ===");
    for (const m of messages) {
      const who =
        m.sender_kind === "ai" ? "AI" : m.sender_kind === "system" ? "System" : m.sender_role ?? "user";
      const tag = m.is_internal ? " [internal]" : "";
      lines.push(`${who}${tag}: ${m.body}`);
    }
  }

  if (isLender && notes.length) {
    lines.push("");
    lines.push("=== INTERNAL NOTES (lender only) ===");
    for (const n of notes) lines.push(n.body);
  }

  return lines.join("\n");
}
