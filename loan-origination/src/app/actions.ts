"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  coerceForType,
  setFieldLockRow,
  upsertFieldValue,
  writeIntakeFields,
} from "@/lib/fields";
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

  // P14 bridge: mirror captured facts into loan_field_values (the single store).
  // The intake agent still uses legacy keys; writeIntakeFields maps them and skips
  // calculated fields. P17 replaces this with a dictionary-native record_intake schema.
  const intakeRaw: Record<string, unknown> = { ...(fields.quote_fields ?? {}) };
  if (fields.borrower_name) intakeRaw.borrower_name = fields.borrower_name;
  if (fields.expected_close_date && /^\d{4}-\d{2}-\d{2}$/.test(fields.expected_close_date)) {
    intakeRaw.closing_date = fields.expected_close_date;
  }
  if (fields.loan_type_key) {
    intakeRaw.loan_program = PROGRAM_LABEL[fields.loan_type_key] ?? fields.loan_type_key.toUpperCase();
  }
  if (Object.keys(intakeRaw).length) {
    const { data: defRows } = await admin.from("field_definitions").select("key,type,source");
    const defs = Object.fromEntries(
      (defRows ?? []).map((d) => [d.key, { type: d.type as string, source: d.source as string | null }]),
    );
    await writeIntakeFields(admin, loanId, intakeRaw, defs);
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

// ---------- M4: DSCR quoting ----------
import { priceLoan, type PricingConfig, type QuoteInput, type QuoteResult } from "@/lib/pricing/engine";

export async function quoteLoan(
  loanId: string,
  input: QuoteInput,
): Promise<{ ok: boolean; result?: QuoteResult; error?: string }> {
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
  if (!profile?.is_lending_team) return { ok: false, error: "Lending team only." };

  const { data: loan } = await supabase.from("loans").select("program_id").eq("id", loanId).single();
  if (!loan?.program_id) return { ok: false, error: "No loan program set on this loan." };

  const admin = createServiceRoleClient();
  const { data: pricing } = await admin
    .from("program_pricing")
    .select("model")
    .eq("program_id", loan.program_id)
    .single();
  const engine = (pricing?.model as { engine?: PricingConfig } | null)?.engine;
  if (!engine) {
    return { ok: false, error: "This program has no parsed pricing engine yet." };
  }

  try {
    return { ok: true, result: priceLoan(engine, input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Pricing failed." };
  }
}

export async function postQuoteToChat(
  loanId: string,
  summary: string,
  terms: Record<string, unknown>,
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
  if (!profile?.is_lending_team) return { ok: false, error: "Lending team only." };

  const { data: loan } = await supabase
    .from("loans")
    .select("custom_fields")
    .eq("id", loanId)
    .single();
  if (!loan) return { ok: false, error: "No access to this loan." };

  const admin = createServiceRoleClient();
  // Store the borrower-facing quote terms (no price/points) for the term sheet.
  const custom = { ...((loan.custom_fields as Record<string, unknown>) ?? {}), quote: terms };
  await admin.from("loans").update({ custom_fields: custom }).eq("id", loanId);

  const body = `${summary}\n\nWould you like to proceed with the quoted terms?`;
  const { error } = await admin.from("messages").insert({
    loan_id: loanId,
    sender_kind: "ai",
    sender_role: "ai",
    is_internal: false,
    body,
    payload: { proceed: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Borrower accepted the quote — generate an LOI / term-sheet PDF (served from
 *  /api/loans/[id]/term-sheet) and post it to chat as a clickable document with
 *  an inline Sign control. */
export async function generateTermSheet(loanId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: loan } = await supabase
    .from("loans")
    .select("loan_number,custom_fields")
    .eq("id", loanId)
    .single();
  if (!loan) return { ok: false, error: "No access to this loan." };

  const cf = (loan.custom_fields as Record<string, unknown>) ?? {};
  if (!cf.quote) return { ok: false, error: "There's no quote on file to turn into a term sheet yet." };

  const body =
    "Here is your Letter of Intent / term sheet based on the quoted terms. Please open and review it, " +
    "then sign below to accept and begin the process. Final terms remain subject to underwriting and approval.";

  const admin = createServiceRoleClient();
  const { error } = await admin.from("messages").insert({
    loan_id: loanId,
    sender_kind: "ai",
    sender_role: "ai",
    is_internal: false,
    body,
    payload: {
      sign: true,
      doc: { title: `Letter of Intent — ${loan.loan_number}.pdf`, url: `/api/loans/${loanId}/term-sheet` },
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Records an inline e-signature on the term sheet with signer, timestamp, and IP
 *  (the authentication record), and posts a confirmation. */
export async function signTermSheet(loanId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name,email")
    .eq("id", user.id)
    .single();
  const { data: loan } = await supabase
    .from("loans")
    .select("loan_number,custom_fields")
    .eq("id", loanId)
    .single();
  if (!loan) return { ok: false, error: "No access to this loan." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
  const name = profile?.full_name || profile?.email || "Signer";
  const now = new Date();

  const admin = createServiceRoleClient();
  const custom = {
    ...((loan.custom_fields as Record<string, unknown>) ?? {}),
    term_sheet: { signed_by: name, signed_at: now.toISOString(), ip },
  };
  await admin.from("loans").update({ custom_fields: custom }).eq("id", loanId);

  const body = `✅ Term sheet signed by ${name} on ${now.toLocaleString()} — IP ${ip}.\n(Authentication record; stands in for the e-signature certificate in this prototype. The signed copy is attached below.)`;
  const { error } = await admin.from("messages").insert({
    loan_id: loanId,
    sender_kind: "system",
    sender_role: "system",
    is_internal: false,
    body,
    payload: {
      doc: {
        title: `Letter of Intent — ${loan.loan_number} (signed).pdf`,
        url: `/api/loans/${loanId}/term-sheet`,
      },
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- Loan Data view: edit a single field in loan_field_values ----------

// Title-case names/addresses while preserving business suffixes, state codes, etc.
const KEEP_UPPER = new Set([
  "LLC", "L.L.C.", "INC", "INC.", "LP", "LLP", "PLLC", "DBA", "PO", "US", "USA", "LTD", "CORP",
]);
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);
// Text fields kept verbatim (acronyms / IDs), never title-cased.
const SKIP_NORMALIZE = new Set(["loan_type", "entity_ein", "servicer_id", "package_tracking"]);

function titleCaseWord(w: string): string {
  const up = w.toUpperCase();
  if (KEEP_UPPER.has(up)) return up;
  if (w.length === 2 && US_STATES.has(up)) return up;
  return w.replace(/[A-Za-z]+/g, (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
}

function normalizeFieldValue(key: string, type: string, value: string): string {
  if (type !== "text") return value;
  const t = value.trim();
  if (!t) return t;
  if (key.includes("email")) return t.toLowerCase();
  if (SKIP_NORMALIZE.has(key)) return t;
  return t.split(/(\s+)/).map((tok) => (/\s+/.test(tok) ? tok : titleCaseWord(tok))).join("");
}

export async function saveLoanField(input: {
  loanId: string;
  key: string;
  type: string;
  value: string;
  idx?: number;
  valueKind?: "initial" | "verified";
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const raw = normalizeFieldValue(input.key, input.type, input.value);
  const value = coerceForType(input.type, raw);
  const { error } = await upsertFieldValue(supabase, {
    loanId: input.loanId,
    key: input.key,
    idx: input.idx ?? 1,
    valueKind: input.valueKind ?? "initial",
    value,
    actorId: user.id,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setLoanFieldLock(input: {
  loanId: string;
  key: string;
  idx?: number;
  locked: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await setFieldLockRow(supabase, {
    loanId: input.loanId,
    key: input.key,
    idx: input.idx ?? 1,
    locked: input.locked,
    actorId: user.id,
  });
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

export type UserType = "borrower" | "originator" | "account_manager" | "operations" | "admin";

function rolesFromType(t: UserType) {
  const isLender = t === "admin" || t === "operations" || t === "account_manager";
  return {
    is_lending_team: isLender,
    lender_user_type: isLender ? t : null,
    external_type: isLender ? null : t,
  };
}

export async function setUserType(input: {
  userId: string;
  userType: UserType;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(rolesFromType(input.userType))
    .eq("id", input.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Admin: create a new user with a type. Creates the auth account (email pre-confirmed,
 * so no email is sent), sets their profile type, and returns a one-time temp password.
 */
export async function addUser(input: {
  email: string;
  fullName: string;
  userType: UserType;
}): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { data: me } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();
  if (me?.lender_user_type !== "admin") return { ok: false, error: "Admins only." };

  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email required." };

  const admin = createServiceRoleClient();
  const tempPassword = `Tmp-${Math.random().toString(36).slice(2, 10)}${Math.floor(Math.random() * 90 + 10)}`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName.trim() || null },
  });
  if (createErr || !created?.user) {
    return { ok: false, error: createErr?.message ?? "Could not create user." };
  }

  const { error } = await admin
    .from("profiles")
    .update({ full_name: input.fullName.trim() || null, ...rolesFromType(input.userType) })
    .eq("id", created.user.id);
  if (error) return { ok: false, error: error.message };

  return { ok: true, tempPassword };
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
  mode: "model" | "guidelines" | "document";
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
 * Admin: upload a pricing document (e.g. a rate sheet) for a program. Stored in the
 * private "pricing" Storage bucket; the program's pricing switches to "document" mode
 * with the file reference kept in program_pricing.model.
 */
export async function uploadPricingDocument(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; fileName?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { data: me } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();
  if (me?.lender_user_type !== "admin") return { ok: false, error: "Admins only." };

  const programId = String(formData.get("programId") ?? "");
  const file = formData.get("file");
  if (!programId || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${programId}/${Date.now()}_${safeName}`;

  const admin = createServiceRoleClient();
  const { error: upErr } = await admin.storage
    .from("pricing")
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { error } = await supabase.from("program_pricing").upsert(
    {
      program_id: programId,
      mode: "document",
      model: { file_path: path, file_name: file.name },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id" },
  );
  if (error) return { ok: false, error: error.message };

  return { ok: true, fileName: file.name };
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
