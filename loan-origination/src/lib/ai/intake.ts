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

export type QuoteField = { key: string; label: string; required?: boolean };

export type ProgramAiConfig = {
  quoteFields: QuoteField[];
  style?: string | null;
  examples?: string | null;
};

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
].join("\n");

/** Builds the full system prompt from the base instructions plus admin-configured
 *  per-program style, example conversations, and quote fields (M3). */
function buildSystem(config: ProgramAiConfig): string {
  const parts = [BASE_SYSTEM];

  if (config.quoteFields.length) {
    const list = config.quoteFields
      .map((f) => `- ${f.label} (key: ${f.key})${f.required ? " [required for a quote]" : ""}`)
      .join("\n");
    parts.push(
      [
        "For an initial quote on THIS loan program, also gather these inputs and record them in the record_intake tool's quote_fields object (use the given keys):",
        list,
      ].join("\n"),
    );
  }

  if (config.style && config.style.trim()) {
    parts.push("CONVERSATION STYLE (follow this voice and these guardrails):\n" + config.style.trim());
  }

  if (config.examples && config.examples.trim()) {
    parts.push("EXAMPLE CONVERSATIONS (mirror this phrasing and flow):\n" + config.examples.trim());
  }

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
  config: ProgramAiConfig;
}): Promise<{ reply: string; fields: IntakeFields } | null> {
  const { supabase, loanId, config } = opts;

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

  const system = buildSystem(config);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
  const fields: IntakeFields = {};
  let reply = "";

  // Up to two passes: first may call the tool (extraction); the follow-up produces the reply.
  for (let i = 0; i < 2; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: [recordIntakeTool],
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
        const inp = tu.input as IntakeFields;
        const mergedQuote = { ...(fields.quote_fields ?? {}), ...(inp.quote_fields ?? {}) };
        Object.assign(fields, inp);
        if (Object.keys(mergedQuote).length) fields.quote_fields = mergedQuote;
      }
      messages.push({ role: "assistant", content: resp.content });
      messages.push({
        role: "user",
        content: toolUses.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: "Recorded.",
        })),
      });
      continue; // loop again to get the natural-language reply
    }
    break;
  }

  return { reply: reply || "Got it — thanks.", fields };
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
