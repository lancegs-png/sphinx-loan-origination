"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { answerLoanQuestion } from "@/lib/ai/record-keeper";
import {
  runIntakeTurn,
  detectLoanTypeKey,
  PROGRAM_LABEL,
  type ProgramAiConfig,
  type GlobalIntakeConfig,
  type QuoteField,
} from "@/lib/ai/intake";

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
    sender_kind: "ai",
    sender_role: "ai",
    body: "Let’s set up this loan. First — are you the borrower, or an originator (broker / referral partner)? And who is the borrower?",
  });

  redirect(`/loans/${loan.id}`);
}

/**
 * One turn of the conversational intake (design §6). The chat posts the user's
 * message, then calls this; the AI extracts fields, updates the loan record, and
 * replies with the next question. Field writes go through the service role after
 * the user-scoped retrieval confirms access; the reply is a shared AI message.
 */
export async function intakeTurn(
  loanId: string,
  userText: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: loan } = await supabase
    .from("loans")
    .select("stage,program_id,custom_fields")
    .eq("id", loanId)
    .single();
  if (!loan) return { ok: false, error: "No access to this loan." };
  if (loan.stage !== "intake") return { ok: false, error: "This loan is past intake." };

  const admin = createServiceRoleClient();

  // Global intake config (applies before a program is known). Read via service role —
  // it's org config, not loan data (design §5.2).
  let global: GlobalIntakeConfig = { baseFields: [], style: null, examples: null };
  {
    const { data: row } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "intake_global")
      .single();
    const v = (row?.value ?? {}) as {
      base_fields?: QuoteField[];
      style?: string | null;
      examples?: string | null;
    };
    global = {
      baseFields: Array.isArray(v.base_fields) ? v.base_fields : [],
      style: v.style ?? null,
      examples: v.examples ?? null,
    };
  }

  // Resolve the effective program: the one already set, else detect the loan type from
  // this turn's text so the program layer applies in the SAME turn (no one-turn lag).
  let effectiveProgramId: string | null = loan.program_id ?? null;
  if (!effectiveProgramId) {
    const key = detectLoanTypeKey(userText);
    if (key) {
      const { data: prog } = await supabase
        .from("loan_programs")
        .select("id")
        .eq("loan_type_key", key)
        .single();
      if (prog) effectiveProgramId = prog.id;
    }
  }

  let program: ProgramAiConfig = { quoteFields: [], style: null, examples: null };
  if (effectiveProgramId) {
    const { data: cfg } = await admin
      .from("program_ai_config")
      .select("quote_fields,intake_style,intake_examples")
      .eq("program_id", effectiveProgramId)
      .single();
    if (cfg) {
      program = {
        quoteFields: Array.isArray(cfg.quote_fields) ? cfg.quote_fields : [],
        style: cfg.intake_style,
        examples: cfg.intake_examples,
      };
    }
  }

  let result: Awaited<ReturnType<typeof runIntakeTurn>>;
  try {
    result = await runIntakeTurn({ supabase, loanId, global, program });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Intake failed." };
  }
  if (!result) return { ok: false, error: "No access to this loan." };

  const { reply, fields, form } = result;

  const updates: Record<string, unknown> = {};
  if (fields.borrower_name) updates.borrower_name = fields.borrower_name;
  if (typeof fields.loan_amount === "number") updates.loan_amount = fields.loan_amount;
  if (fields.property_address) updates.property_address = fields.property_address;
  if (fields.expected_close_date && /^\d{4}-\d{2}-\d{2}$/.test(fields.expected_close_date)) {
    updates.expected_close_date = fields.expected_close_date;
  }
  if (fields.loan_type_key) {
    updates.loan_type = PROGRAM_LABEL[fields.loan_type_key];
    const { data: prog } = await supabase
      .from("loan_programs")
      .select("id")
      .eq("loan_type_key", fields.loan_type_key)
      .single();
    if (prog) updates.program_id = prog.id;
  }
  if (fields.quote_fields && Object.keys(fields.quote_fields).length) {
    const existing = (loan.custom_fields as Record<string, unknown>) ?? {};
    updates.custom_fields = { ...existing, ...fields.quote_fields };
  }
  if (Object.keys(updates).length) {
    await admin.from("loans").update(updates).eq("id", loanId);
  }

  const { error } = await admin.from("messages").insert({
    loan_id: loanId,
    sender_kind: "ai",
    sender_role: "ai",
    is_internal: false,
    body: reply,
    payload: form ? { form } : null,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Admin: save the GLOBAL intake config — base/opening questions, default style,
 * default examples. Applies before a loan program is known. RLS restricts to Admin.
 */
export async function saveGlobalIntakeConfig(input: {
  baseFields: QuoteField[];
  style: string;
  examples: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "intake_global",
      value: {
        base_fields: input.baseFields,
        style: input.style.trim() || null,
        examples: input.examples.trim() || null,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- Admin backend: document types, checklists, pricing, users ----------

export async function saveDocumentType(input: {
  id?: string;
  key: string;
  name: string;
  defaultNaming: string;
  defaultReviewRules: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const row = {
    key: input.key.trim() || input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    name: input.name.trim(),
    default_naming_convention: input.defaultNaming.trim() || null,
    default_review_rules: input.defaultReviewRules.trim() || null,
  };
  const { error } = input.id
    ? await supabase.from("document_types").update(row).eq("id", input.id)
    : await supabase.from("document_types").insert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteDocumentType(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("document_types").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setUserRole(input: {
  userId: string;
  isLendingTeam: boolean;
  lenderUserType: "admin" | "operations" | "account_manager" | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      is_lending_team: input.isLendingTeam,
      lender_user_type: input.isLendingTeam ? input.lenderUserType : null,
    })
    .eq("id", input.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type ChecklistItemInput = {
  documentTypeId: string;
  required: boolean;
  assignee: "borrower" | "lending_team";
  namingOverride: string;
  reviewRulesOverride: string;
};

export async function saveProgramChecklist(
  programId: string,
  items: ChecklistItemInput[],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("program_checklist_items")
    .delete()
    .eq("program_id", programId);
  if (delErr) return { ok: false, error: delErr.message };

  if (items.length) {
    const rows = items.map((it, i) => ({
      program_id: programId,
      document_type_id: it.documentTypeId,
      required: it.required,
      assignee: it.assignee,
      naming_override: it.namingOverride.trim() || null,
      review_rules_override: it.reviewRulesOverride.trim() || null,
      sort: i,
    }));
    const { error } = await supabase.from("program_checklist_items").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function saveProgramPricing(input: {
  programId: string;
  mode: "model" | "guidelines";
  guidelines: string;
  model: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("program_pricing").upsert(
    {
      program_id: input.programId,
      mode: input.mode,
      guidelines: input.guidelines.trim() || null,
      model: input.model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Admin: save a loan program's AI intake config (M3) — quote fields, style, examples.
 * RLS (program_ai_config_write) restricts this to Admin users.
 */
export async function saveProgramAiConfig(input: {
  programId: string;
  quoteFields: QuoteField[];
  intakeStyle: string;
  intakeExamples: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("program_ai_config").upsert(
    {
      program_id: input.programId,
      quote_fields: input.quoteFields,
      intake_style: input.intakeStyle.trim() || null,
      intake_examples: input.intakeExamples.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
