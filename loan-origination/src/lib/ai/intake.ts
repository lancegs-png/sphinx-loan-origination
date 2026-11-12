import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

// Fields the intake agent extracts (design §6, R-INTAKE-*). Dictionary-native (P17):
// all captured values go in `fields`, keyed by data-dictionary keys. All optional —
// captured incrementally over the conversation.
export type IntakeFields = {
  submitter_role?: "borrower" | "originator";
  originator_name?: string;
  loan_type_key?:
    | "bridge"
    | "fix_and_flip"
    | "new_construction"
    | "dscr"
    | "rtl"
    | "commercial_bridge"
    | "commercial_permanent";
  notes?: string;
  // Captured values keyed by data-dictionary field keys (the configured intake fields).
  fields?: Record<string, string | number | boolean>;
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
  if (/\bdscr\b|rental|buy.?and.?hold/.test(t)) return "dscr";
  // Fix & flip, bridge, and new construction all map to the RTL program.
  if (/fix.{0,4}(and|&|n).{0,4}flip|\bflip\b|new construction|ground.?up|\bconstruction\b|\bbridge\b|\brtl\b|rehab/.test(t)) {
    return "rtl";
  }
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
      originator_name: { type: "string" },
      loan_type_key: {
        type: "string",
        enum: [
          "bridge",
          "fix_and_flip",
          "new_construction",
          "dscr",
          "rtl",
          "commercial_bridge",
          "commercial_permanent",
        ],
        description: "The loan program. DSCR for rentals; RTL for fix & flip / bridge / new construction.",
      },
      notes: { type: "string" },
      fields: {
        type: "object",
        additionalProperties: true,
        description:
          "Captured values keyed by the data-dictionary field keys listed in the gather lists (e.g. property_street, borrower_entity, guarantor_first_name, as_is_value, monthly_rent).",
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
  "Guide a natural, one-step-at-a-time conversation, keeping replies short and friendly:",
  "- First, if not yet known, ask whether they are the borrower or an originator (broker / referral partner); record submitter_role. If an originator, also gather the borrower's contact.",
  "- Early on, determine the loan program and record it as loan_type_key: DSCR (rental / buy-and-hold) or RTL (fix & flip, bridge, or new construction). Multifamily properties use DSCR.",
  "- Then work through the gather lists below, one item at a time.",
  "Record every captured value by calling record_intake with a `fields` object keyed by the data-dictionary keys shown in the lists (e.g. { \"property_street\": \"123 Main St\", \"borrower_entity\": \"Acme LLC\" }). Confirm what you captured in one short line, then ask for the next single missing item.",
  "When you have the program, property, borrower/guarantor, and the program's key inputs, give a brief summary and tell them a team member will follow up with a quote within 24 hours.",
  "Never invent values. Ask rather than assume. A borrower who doesn't yet have an entity can answer \"Entity TBD\" for borrower_entity.",
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
      "Once the loan type is known, also gather these inputs for an initial quote and record them in record_intake's `fields` object (use the given keys):\n" +
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
  rtl: "RTL",
  commercial_bridge: "Commercial Bridge",
  commercial_permanent: "Commercial Permanent",
};

export { PROGRAM_LABEL };

type LoanRecord = {
  loan_type: string | null;
  loan_amount: number | null;
  property_address: string | null;
  borrower_name: string | null;
  closing_date: string | null;
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
    .select("loan_type,loan_amount,property_address,borrower_name,closing_date")
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
          const merged = { ...(fields.fields ?? {}), ...(inp.fields ?? {}) };
          Object.assign(fields, inp);
          if (Object.keys(merged).length) fields.fields = merged;
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
    `Expected closing: ${f(loan.closing_date)}`,
  ].join("\n");
}
