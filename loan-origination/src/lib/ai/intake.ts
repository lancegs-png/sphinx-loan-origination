import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

// Fields the intake agent can extract (design §6, R-INTAKE-*). All optional —
// captured incrementally over the conversation.
export type IntakeFields = {
  submitter_role?: "borrower" | "originator";
  borrower_name?: string;
  borrower_kind?: "individual" | "entity";
  entity_type?: "corporation" | "llc" | "trust";
  originator_name?: string;
  loan_type_key?:
    | "bridge"
    | "fix_and_flip"
    | "new_construction"
    | "dscr"
    | "commercial_bridge"
    | "commercial_permanent";
  loan_amount?: number;
  property_address?: string;
  expected_close_date?: string; // YYYY-MM-DD
  notes?: string;
  // Program-specific quote inputs (keys come from the program's configured quote fields).
  quote_fields?: Record<string, string | number | boolean>;
};

export type FieldType = "text" | "number" | "currency" | "date" | "select";
export type QuoteField = {
  key: string;
  label: string;
  required?: boolean;
  type?: FieldType;
  options?: string[];
};

// An inline form the AI asks in the chat (rendered as dropdowns / inputs).
export type IntakeForm = {
  intro?: string;
  fields: { key: string; label: string; type?: FieldType; options?: string[]; required?: boolean }[];
};

export type ProgramAiConfig = {
  quoteFields: QuoteField[];
  style?: string | null;
  examples?: string | null;
};

// Global intake config (applies before a loan program is known).
export type GlobalIntakeConfig = {
  baseFields: QuoteField[];
  style?: string | null;
  examples?: string | null;
};

/** Heuristic: guess the loan program key from the user's text so program-specific
 *  questions can apply in the SAME turn the loan type is mentioned (no one-turn lag).
 *  A miss just means the program layer applies on the next turn. */
export function detectLoanTypeKey(text: string): IntakeFields["loan_type_key"] | null {
  const t = text.toLowerCase();
  if (/commercial.*(permanent|perm)/.test(t)) return "commercial_permanent";
  if (/commercial.*bridge/.test(t)) return "commercial_bridge";
  if (/\bdscr\b|rental/.test(t)) return "dscr";
  if (/fix.{0,4}(and|&|n).{0,4}flip|\bflip\b/.test(t)) return "fix_and_flip";
  if (/new construction|ground.?up|\bconstruction\b/.test(t)) return "new_construction";
  if (/\bbridge\b/.test(t)) return "bridge";
  return null;
}

const recordIntakeTool: Anthropic.Tool = {
  name: "record_intake",
  description:
    "Record new intake details about the loan as you learn them. Call this whenever the user provides a fact you didn't already have. Only include fields you are confident about.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      submitter_role: { type: "string", enum: ["borrower", "originator"] },
      borrower_name: { type: "string" },
      borrower_kind: { type: "string", enum: ["individual", "entity"] },
      entity_type: { type: "string", enum: ["corporation", "llc", "trust"] },
      originator_name: { type: "string" },
      loan_type_key: {
        type: "string",
        enum: [
          "bridge",
          "fix_and_flip",
          "new_construction",
          "dscr",
          "commercial_bridge",
          "commercial_permanent",
        ],
      },
      loan_amount: { type: "number" },
      property_address: { type: "string" },
      expected_close_date: { type: "string", description: "ISO date YYYY-MM-DD" },
      notes: { type: "string" },
      quote_fields: {
        type: "object",
        additionalProperties: true,
        description:
          "Program-specific quote inputs as key/value pairs. Use the keys listed in the program's required quote fields.",
      },
    },
  },
};

const askFieldsTool: Anthropic.Tool = {
  name: "ask_fields",
  description:
    "Ask the user for a small group of 2-5 inputs as an inline form in the chat. Use this especially when fields have fixed options (rendered as dropdowns), or to collect a few related values at once. Keep it to 5 fields max. The user can also just answer in free text.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["fields"],
    properties: {
      intro: { type: "string", description: "One short sentence shown above the form." },
      fields: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label"],
          properties: {
            key: { type: "string", description: "Field key (use configured keys where they exist)." },
            label: { type: "string" },
            type: { type: "string", enum: ["text", "number", "currency", "date", "select"] },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Required when type is select.",
            },
            required: { type: "boolean" },
          },
        },
      },
    },
  },
};

const BASE_SYSTEM = [
  "You are the AI originator for a private loan platform, conducting intake for a NEW loan in a chat.",
  "Guide a natural Who / What / Where / When / Why conversation, one step at a time, keeping replies short and friendly:",
  "- First, if not yet known, ask whether they are the borrower or an originator (broker / referral partner). If an originator, also gather the borrower's name.",
  "- Who: borrower name; is the borrower an individual or an entity (LLC, corporation, trust)?",
  "- What: loan type (map to one of bridge, fix & flip, new construction, DSCR, commercial bridge, commercial permanent), loan amount.",
  "- Where: property address (and note if there are multiple properties).",
  "- When: expected closing timing.",
  "- Why: any additional notes about the deal.",
  "Whenever the user gives you a fact, call record_intake with the new field(s). Confirm what you captured in one short line, then ask for the next single missing item.",
  "When you have borrower, loan type, amount, property, and timing, give a brief summary and tell them a team member will follow up with a quote or feedback within 24 hours.",
  "Never invent values. Ask rather than assume.",
  "Normalize capitalization when you record values: put personal names, business/entity names, street addresses, and city names in proper title case (e.g., 'mike brown' -> 'Mike Brown', '123 main st' -> '123 Main St'). Keep email addresses lowercase. Use uppercase two-letter state abbreviations (e.g., 'tx' -> 'TX'). Preserve conventional business suffixes (LLC, Inc, LP, LLP, Corp) and street-type abbreviations (St, Ave, Rd, Blvd, Ln, Dr). Do not change numeric values the user provided.",
  "Stay conversational. You MAY ask in plain text, but when a field has fixed options (e.g. purchase vs refinance, individual vs entity, loan type) or when a few related values go together, call ask_fields to present a small inline form (2-5 inputs) — put option-bearing fields as type 'select' with their options so they render as dropdowns. Always call record_intake to save the facts you learn, whether from text or a submitted form.",
].join("\n");

function fieldHint(f: { type?: FieldType; options?: string[] }): string {
  if (f.type === "select" && f.options?.length) return ` [select: ${f.options.join(", ")}]`;
  if (f.type) return ` [${f.type}]`;
  return "";
}

/** Builds the full system prompt: base instructions + the GLOBAL intake config
 *  (opening questions, default style/examples) + the per-program layer that applies
 *  conditionally once the loan type is known (quote fields; style/examples override). */
function buildSystem(global: GlobalIntakeConfig, program: ProgramAiConfig): string {
  const parts = [BASE_SYSTEM];

  if (global.baseFields.length) {
    const list = global.baseFields
      .map((f) => `- ${f.label} (key: ${f.key})${fieldHint(f)}${f.required ? " [required]" : ""}`)
      .join("\n");
    parts.push(
      "Opening questions to cover first, one at a time, before any loan-type-specific questions:\n" +
        list,
    );
  }

  if (program.quoteFields.length) {
    const list = program.quoteFields
      .map((f) => `- ${f.label} (key: ${f.key})${fieldHint(f)}${f.required ? " [required for a quote]" : ""}`)
      .join("\n");
    parts.push(
      "Once the loan type is known, also gather these inputs for an initial quote and record them in the record_intake tool's quote_fields object (use the given keys):\n" +
        list,
    );
  }

  // Program style/examples override the global defaults when present.
  const style = program.style?.trim() || global.style?.trim();
  if (style) parts.push("CONVERSATION STYLE (follow this voice and these guardrails):\n" + style);

  const examples = program.examples?.trim() || global.examples?.trim();
  if (examples) parts.push("EXAMPLE CONVERSATIONS (mirror this phrasing and flow):\n" + examples);

  return parts.join("\n\n");
}

const PROGRAM_LABEL: Record<NonNullable<IntakeFields["loan_type_key"]>, string> = {
  bridge: "Bridge",
  fix_and_flip: "Fix and Flip",
  new_construction: "New Construction",
  dscr: "DSCR",
  commercial_bridge: "Commercial Bridge",
  commercial_permanent: "Commercial Permanent",
};

export { PROGRAM_LABEL };

type LoanRecord = {
  loan_type: string | null;
  loan_amount: number | null;
  property_address: string | null;
  borrower_name: string | null;
  expected_close_date: string | null;
};

/**
 * Runs one intake turn: reads the loan record + conversation (user-scoped, RLS),
 * asks Claude to extract fields and reply, and returns both.
 * Returns null if the caller has no access to the loan.
 */
export async function runIntakeTurn(opts: {
  supabase: SupabaseClient;
  loanId: string;
  global: GlobalIntakeConfig;
  program: ProgramAiConfig;
}): Promise<{ reply: string; fields: IntakeFields; form?: IntakeForm } | null> {
  const { supabase, loanId, global, program } = opts;

  const { data: loan } = await supabase
    .from("loans")
    .select("loan_type,loan_amount,property_address,borrower_name,expected_close_date")
    .eq("id", loanId)
    .single();
  if (!loan) return null;

  const { data: msgs } = await supabase
    .from("messages")
    .select("sender_kind,sender_role,body,created_at")
    .eq("loan_id", loanId)
    .order("created_at", { ascending: true })
    .limit(30);

  const transcript = (msgs ?? [])
    .map((m: { sender_kind: string; sender_role: string | null; body: string }) => {
      const who = m.sender_kind === "ai" ? "You (AI)" : m.sender_kind === "system" ? "System" : "User";
      return `${who}: ${m.body}`;
    })
    .join("\n");

  const captured = capturedSummary(loan as LoanRecord);

  const userPrompt = [
    "=== CAPTURED SO FAR ===",
    captured,
    "",
    "=== CONVERSATION ===",
    transcript || "(none yet)",
    "",
    "Respond to the user's latest message: record any new details with record_intake, then reply with a short confirmation and the next single question.",
  ].join("\n");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system = buildSystem(global, program);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
  const fields: IntakeFields = {};
  let form: IntakeForm | undefined;
  let reply = "";

  // Up to two passes: first may call the tool (extraction); the follow-up produces the reply.
  for (let i = 0; i < 2; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: [recordIntakeTool, askFieldsTool],
      messages,
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) reply = text;

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (resp.stop_reason === "tool_use" && toolUses.length) {
      for (const tu of toolUses) {
        if (tu.name === "record_intake") {
          const inp = tu.input as IntakeFields;
          const mergedQuote = { ...(fields.quote_fields ?? {}), ...(inp.quote_fields ?? {}) };
          Object.assign(fields, inp);
          if (Object.keys(mergedQuote).length) fields.quote_fields = mergedQuote;
        } else if (tu.name === "ask_fields") {
          form = tu.input as IntakeForm;
        }
      }
      messages.push({ role: "assistant", content: resp.content });
      messages.push({
        role: "user",
        content: toolUses.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: tu.name === "ask_fields" ? "Form shown to the user." : "Recorded.",
        })),
      });
      continue; // loop again to get the natural-language reply
    }
    break;
  }

  return { reply: reply || (form?.intro ?? "Got it — thanks."), fields, form };
}

function capturedSummary(loan: LoanRecord): string {
  const f = (v: string | number | null) => (v == null || v === "" ? "not captured" : String(v));
  return [
    `Borrower: ${f(loan.borrower_name)}`,
    `Loan type: ${f(loan.loan_type)}`,
    `Loan amount: ${f(loan.loan_amount)}`,
    `Property: ${f(loan.property_address)}`,
    `Expected closing: ${f(loan.expected_close_date)}`,
  ].join("\n");
}
