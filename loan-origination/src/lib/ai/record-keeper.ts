import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stageLabel } from "@/lib/stages";
import { loadLoanChecklist } from "@/lib/checklist";
import { loadFieldValues } from "@/lib/fields";
import type { ChecklistItem, FieldDef, FieldValues } from "@/lib/types";

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
      "loan_number,opportunity_number,stage,status,loan_type,loan_amount,property_address,borrower_name,closing_date,program_id",
    )
    .eq("id", loanId)
    .single();

  // RLS returns null when the caller isn't a participant — no access, no answer.
  if (!loan) return null;

  const [
    { data: program },
    { data: messages },
    notesResult,
    checklist,
    fieldValues,
    { data: fieldDefs },
    { data: participants },
  ] = await Promise.all([
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
    // The document checklist (statuses + notes) so the AI can answer what's outstanding.
    loadLoanChecklist(supabase, loanId, loan.program_id),
    // Full loan field values + their definitions (labels/sections), and the people on the deal.
    loadFieldValues(supabase, loanId),
    supabase.from("field_definitions").select("key,label,section,sort,type,lender_only").order("sort"),
    supabase
      .from("deal_participants")
      .select("participant_role, profiles(full_name,email)")
      .eq("loan_id", loanId),
  ]);

  const context = buildContext({
    loan,
    program: program as { name: string; public_info: string | null } | null,
    messages: (messages as ConvMessage[]) ?? [],
    notes: (notesResult.data as { body: string }[]) ?? [],
    checklist: checklist ?? [],
    fieldValues: fieldValues ?? {},
    fieldDefs: (fieldDefs as FieldDef[]) ?? [],
    participants: (participants as ParticipantRow[]) ?? [],
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

type ProfileRef = { full_name: string | null; email: string | null };
type ParticipantRow = { participant_role: string; profiles: ProfileRef | ProfileRef[] | null };

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
    loan_number: string | null;
    opportunity_number: string;
    stage: string;
    status: string;
    loan_type: string | null;
    loan_amount: number | null;
    property_address: string | null;
    borrower_name: string | null;
    closing_date: string | null;
  };
  program: { name: string; public_info: string | null } | null;
  messages: ConvMessage[];
  notes: { body: string }[];
  checklist: ChecklistItem[];
  fieldValues: FieldValues;
  fieldDefs: FieldDef[];
  participants: ParticipantRow[];
  isLender: boolean;
}): string {
  const { loan, program, messages, notes, checklist, fieldValues, fieldDefs, participants, isLender } = args;

  const lines: string[] = [];
  lines.push("=== LOAN RECORD ===");
  lines.push(
    loan.loan_number
      ? `Loan number: ${loan.loan_number}`
      : `Opportunity number: ${loan.opportunity_number} (loan number assigned once the term sheet is signed)`,
  );
  lines.push(`Stage: ${stageLabel(loan.stage)}`);
  lines.push(`Status: ${loan.status}`);
  lines.push(`Loan type: ${loan.loan_type ?? "unknown"}`);
  lines.push(`Loan amount: ${money(loan.loan_amount)}`);
  lines.push(`Property: ${loan.property_address ?? "unknown"}`);
  lines.push(`Borrower: ${loan.borrower_name ?? "unknown"}`);
  lines.push(`Expected closing: ${loan.closing_date ?? "unknown"}`);

  if (program) {
    lines.push("");
    lines.push("=== PROGRAM ===");
    lines.push(`Program: ${program.name}`);
    if (program.public_info) lines.push(program.public_info);
  }

  // Full loan field values (current = verified ?? initial), grouped by section. Internal
  // sections and lender-only fields are omitted for non-lenders.
  const INTERNAL_SECTIONS = new Set(["trade", "closing", "data_tape"]);
  const SECTION_LABEL: Record<string, string> = {
    loan: "Loan Information",
    property: "Property Information",
    dscr_calc: "DSCR Calculation",
    trade: "Trade Information",
    borrower: "Borrower Information",
    contact: "Contacts",
    closing: "Closing Calculations",
    data_tape: "Data Tape",
    additional: "Additional Information",
  };
  const bySection = new Map<string, string[]>();
  for (const d of fieldDefs) {
    if (!isLender && (d.lender_only || INTERNAL_SECTIONS.has(d.section))) continue;
    const cur = fieldValues[d.key]?.current;
    if (cur == null || cur === "") continue;
    const s = String(cur);
    const val =
      d.type === "currency"
        ? `$${Number(s.replace(/[^0-9.-]/g, "")).toLocaleString()}`
        : d.type === "percent"
          ? `${s}%`
          : s;
    const arr = bySection.get(d.section) ?? [];
    arr.push(`  ${d.label}: ${val}`);
    bySection.set(d.section, arr);
  }
  if (bySection.size) {
    lines.push("");
    lines.push("=== LOAN DETAILS (Loan Info tab) ===");
    for (const [sec, items] of bySection) {
      lines.push(`[${SECTION_LABEL[sec] ?? sec}]`);
      lines.push(...items);
    }
  }

  if (participants.length) {
    lines.push("");
    lines.push("=== PEOPLE ON THIS DEAL (People tab) ===");
    for (const p of participants) {
      const prof = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
      const name = prof?.full_name || prof?.email || "Unknown";
      const email = prof?.email ? ` <${prof.email}>` : "";
      lines.push(`- ${name}${email} — ${p.participant_role.replace(/_/g, " ")}`);
    }
  }

  if (checklist.length) {
    const STATUS_LABEL: Record<string, string> = {
      outstanding: "Outstanding (not yet received)",
      ordered: "Ordered",
      update_needed: "Update needed",
      approved: "Approved / received",
      not_applicable: "N/A",
    };
    lines.push("");
    lines.push("=== DOCUMENT CHECKLIST ===");
    lines.push("Each item is a required document and its current status.");
    for (const c of checklist) {
      const status = STATUS_LABEL[c.status] ?? c.status;
      const who = c.assignee === "lending_team" ? "lender-ordered" : c.assignee === "additional" ? "case-by-case" : "borrower-provided";
      lines.push(`- ${c.name} [${who}]: ${status}${c.notes ? ` — note: ${c.notes}` : ""}`);
    }
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
