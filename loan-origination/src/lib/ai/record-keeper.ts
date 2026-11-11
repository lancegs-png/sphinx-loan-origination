import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stageLabel, STAGES } from "@/lib/stages";
import { loadLoanChecklist } from "@/lib/checklist";
import { loadFieldValues } from "@/lib/fields";
import type { ChecklistItem, FieldDef, FieldValues } from "@/lib/types";

// Default to the current Claude model; overridable via env.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

// ---- AI-proposed changes (lender-only; applied only after the user confirms) ----
export type ProposedFieldUpdate = { key: string; label: string; value: string };
export type ProposedChecklistUpdate = { document: string; status: string };
export type ProposedUpdates = {
  summary: string;
  fieldUpdates: ProposedFieldUpdate[];
  stage: { key: string; label: string } | null;
  checklistUpdates: ProposedChecklistUpdate[];
};
export type LoanAnswer = { text: string; proposal: ProposedUpdates | null };

type WritableField = { key: string; label: string; type: string; options: string[]; current: unknown };

// Fields the AI may propose changes to: user-maintained inputs, never calculated/system
// (those are derived or read-only, and the DB rejects writes to them anyway).
const WRITABLE_SOURCES = new Set(["intake", "manual", "config"]);
const CHECK_STATUSES = ["outstanding", "ordered", "update_needed", "approved", "not_applicable"] as const;

function writableFields(defs: FieldDef[], values: FieldValues): WritableField[] {
  return defs
    .filter((d) => WRITABLE_SOURCES.has(d.source ?? ""))
    .map((d) => ({
      key: d.key,
      label: d.label,
      type: d.type,
      options: d.options ?? [],
      current: values[d.key]?.current ?? null,
    }));
}

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
}): Promise<LoanAnswer | null> {
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
    supabase
      .from("field_definitions")
      .select("key,label,section,sort,type,lender_only,source,options")
      .order("sort"),
    supabase
      .from("deal_participants")
      .select("participant_role, profiles(full_name,email)")
      .eq("loan_id", loanId),
  ]);

  // Only lenders can propose changes; borrowers/originators stay read-only.
  const writable = isLender ? writableFields((fieldDefs as FieldDef[]) ?? [], fieldValues ?? {}) : [];

  const context = buildContext({
    loan,
    program: program as { name: string; public_info: string | null } | null,
    messages: (messages as ConvMessage[]) ?? [],
    notes: (notesResult.data as { body: string }[]) ?? [],
    checklist: checklist ?? [],
    fieldValues: fieldValues ?? {},
    fieldDefs: (fieldDefs as FieldDef[]) ?? [],
    participants: (participants as ParticipantRow[]) ?? [],
    writable,
    isLender,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt(isLender),
    messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
    ...(writable.length ? { tools: [updateTool(writable.map((w) => w.key))] } : {}),
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (response.stop_reason === "refusal") {
    return { text: "I'm not able to answer that.", proposal: null };
  }

  const proposal = extractProposal(response, writable);

  return {
    text: text || (proposal ? proposal.summary : "I don't have that information in this loan's record."),
    proposal,
  };
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
    "Answer questions about this specific loan accurately, using ONLY the loan context provided.",
    "Answer ONLY the specific question asked. Give the requested figure or fact directly and then stop — do not volunteer related numbers, breakdowns, derivations, formulas, assumptions, or extra context the user did not ask for.",
    "Keep answers short. Do not reference, restate, or correct your own earlier replies.",
    "Respond in PLAIN TEXT only — no Markdown. Do not use asterisks for bold/italics, do not use # headers, and do not use -, *, or numbered bullets for lists. Write plain sentences; if you must list items, separate them with commas or newlines, with no leading symbols.",
    "If the answer is not in the context, say you don't have that information rather than guessing.",
    "Do not invent amounts, dates, rates, or statuses.",
  ];
  if (isLender) {
    base.push(
      "You are speaking with a member of the lending team; you may reference internal notes and trade data included in the context.",
      "If the user asks to change, set, update, correct, add, or move something — a field value, the loan stage, or a document's status — call the propose_loan_updates tool with the proposed change(s) instead of answering in words, and never claim you have changed anything. Nothing is saved until the user confirms the card the tool produces. Only propose fields listed under EDITABLE FIELDS. For questions, answer normally and do not call the tool.",
    );
  } else {
    base.push(
      "You are speaking with the borrower or their originator. Never reveal internal lender notes, trade terms, or confidential information. Only the context you were given is available to you.",
      "You cannot make any changes to the loan record. If asked to change, set, or update something, say the lending team will need to make that update — never claim you changed anything.",
    );
  }
  return base.join(" ");
}

function money(n: number | null): string {
  return n == null ? "unknown" : `$${n.toLocaleString()}`;
}

/** The tool the model calls to propose record changes (lender-only). We capture its
 *  input as a proposal and surface it for the user to confirm — we never auto-apply. */
function updateTool(writableKeys: string[]): Anthropic.Tool {
  return {
    name: "propose_loan_updates",
    description:
      "Propose one or more changes to this loan's record for the user to review and confirm. " +
      "Call this whenever the user asks to change, set, update, correct, add, or move a value — a loan field, the loan stage, or a document's checklist status. " +
      "Never tell the user you have changed or updated something without calling this tool: the change is only applied after the user clicks Confirm on the card this produces. " +
      "Do not call it for questions — only when the user is asking for a change.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One short, plain-language sentence describing the proposed change(s).",
        },
        field_updates: {
          type: "array",
          description: "Changes to loan field values.",
          items: {
            type: "object",
            properties: {
              key: { type: "string", enum: writableKeys, description: "Field key from the EDITABLE FIELDS list." },
              value: {
                type: "string",
                description:
                  "The new value as a string (e.g. '8', '8%', '1,200,000', 'Single Family Residence', '2026-01-15'). For a select field, use one of its allowed values.",
              },
            },
            required: ["key", "value"],
          },
        },
        stage: {
          type: "string",
          enum: STAGES.map((s) => s.key),
          description: "New loan stage — only if the user asked to move the loan to a different stage.",
        },
        checklist_updates: {
          type: "array",
          description: "Changes to document checklist statuses.",
          items: {
            type: "object",
            properties: {
              document: { type: "string", description: "Document name exactly as shown in the DOCUMENT CHECKLIST." },
              status: { type: "string", enum: [...CHECK_STATUSES] },
            },
            required: ["document", "status"],
          },
        },
      },
      required: ["summary"],
    },
  };
}

function extractProposal(response: Anthropic.Message, writable: WritableField[]): ProposedUpdates | null {
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_loan_updates",
  );
  if (!block) return null;
  const input = block.input as {
    summary?: unknown;
    field_updates?: unknown;
    stage?: unknown;
    checklist_updates?: unknown;
  };
  const labelOf = new Map(writable.map((w) => [w.key, w.label]));

  const fieldUpdates: ProposedFieldUpdate[] = Array.isArray(input.field_updates)
    ? input.field_updates
        .filter(
          (u): u is { key: string; value: unknown } =>
            !!u && typeof (u as { key?: unknown }).key === "string" && labelOf.has((u as { key: string }).key),
        )
        .map((u) => ({ key: u.key, label: labelOf.get(u.key)!, value: String(u.value ?? "") }))
    : [];

  const stageKey = typeof input.stage === "string" ? input.stage : null;
  const stage =
    stageKey && STAGES.some((s) => s.key === stageKey) ? { key: stageKey, label: stageLabel(stageKey) } : null;

  const statusSet = new Set<string>(CHECK_STATUSES);
  const checklistUpdates: ProposedChecklistUpdate[] = Array.isArray(input.checklist_updates)
    ? input.checklist_updates
        .filter(
          (u): u is { document: string; status: string } =>
            !!u &&
            typeof (u as { document?: unknown }).document === "string" &&
            typeof (u as { status?: unknown }).status === "string" &&
            statusSet.has((u as { status: string }).status),
        )
        .map((u) => ({ document: u.document, status: u.status }))
    : [];

  if (!fieldUpdates.length && !stage && !checklistUpdates.length) return null;
  return {
    summary:
      typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : "Apply these changes?",
    fieldUpdates,
    stage,
    checklistUpdates,
  };
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
  writable: WritableField[];
  isLender: boolean;
}): string {
  const { loan, program, messages, notes, checklist, fieldValues, fieldDefs, participants, writable, isLender } = args;

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

  // Fields the lender may ask the AI to change. The AI proposes against these keys;
  // nothing is written until the user confirms.
  if (writable.length) {
    lines.push("");
    lines.push("=== EDITABLE FIELDS (propose changes to these with propose_loan_updates) ===");
    lines.push("Format — key — Label (type): current value. Use the key when proposing a change.");
    for (const w of writable) {
      const cur = w.current == null || w.current === "" ? "(empty)" : String(w.current);
      const opts = w.type === "select" && w.options.length ? ` [allowed: ${w.options.join(", ")}]` : "";
      lines.push(`- ${w.key} — ${w.label} (${w.type}): ${cur}${opts}`);
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
