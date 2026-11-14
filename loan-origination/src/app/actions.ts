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
import { recomputeLoan } from "@/lib/calc";
import { sheetsConfigured, appendSheetRow } from "@/lib/google/sheets";
import { syncLoanToDashboard } from "@/lib/google/dashboard";
import { pushFieldsToSheet, reconcileLoanSheet } from "@/lib/google/sheet-sync";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/audit";
import { answerLoanQuestion } from "@/lib/ai/record-keeper";
import { loadLoanChecklist } from "@/lib/checklist";
import { openDeal } from "@/lib/loans/open-deal";
import { STAGES } from "@/lib/stages";
import { isLoanStatus } from "@/lib/status";
import {
  runIntakeTurn,
  detectLoanTypeKey,
  PROGRAM_LABEL,
  type ProgramAiConfig,
  type GlobalIntakeConfig,
  type QuoteField,
} from "@/lib/ai/intake";
import type { DealContact, InternalNote } from "@/lib/types";

/** Org-level "Loan Tracker" sheet (Loan Number Tracker tab); overridable via env. */
const LOAN_TRACKER_SHEET_ID =
  process.env.GOOGLE_LOAN_TRACKER_SHEET_ID || "1FLrQZqFAJ7v-8cZeT3EGTPJ_Vut6JLPp_rNSXwEbm4Y";

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

  await logEvent(createServiceRoleClient(), {
    loanId: loan.id,
    actorId: user.id,
    eventType: "loan_created",
  });

  redirect(`/loans/${loan.id}`);
}

/**
 * Open a new DSCR deal end-to-end from a short form: the Drive folder (+ subfolders +
 * dashboard), the loan record with the address/guarantor seeded, the program checklist,
 * and either an OPP#### (opportunity) or a permanent SPHX straight into Processing (loan).
 * Lending-team only. Returns the new loan id so the client lands on its page.
 */
export async function openLoan(input: {
  address: string;
  guarantorFirst?: string;
  guarantorLast?: string;
  kind: "opportunity" | "loan";
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();
  if (!profile?.lender_user_type) return { ok: false, error: "Lending team only" };

  const address = input.address.trim();
  if (!address) return { ok: false, error: "Enter the property address" };

  // A "loan" goes straight into Processing with its SPHX number assigned now; an
  // "opportunity" stays at intake with an OPP#### until the term sheet is signed.
  const isLoan = input.kind === "loan";
  try {
    const result = await openDeal(createServiceRoleClient(), {
      address,
      guarantorFirst: input.guarantorFirst,
      guarantorLast: input.guarantorLast,
      stage: isLoan ? "processing" : "intake",
      assignNumber: isLoan,
      createdByUserId: user.id,
      accountManagerId: profile.lender_user_type === "account_manager" ? user.id : null,
    });
    return { ok: true, id: result.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not open the loan" };
  }
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

  // Program: set program_id directly; the loan_program field (written below) syncs the
  // loans.loan_type / loan_program summary columns via trigger.
  if (fields.loan_type_key) {
    const { data: prog } = await supabase
      .from("loan_programs")
      .select("id")
      .eq("loan_type_key", fields.loan_type_key)
      .single();
    if (prog) await admin.from("loans").update({ program_id: prog.id }).eq("id", loanId);
  }

  // P17: the intake agent reports dictionary keys directly. Write captured facts into
  // loan_field_values (the single store), then recompute derived fields. Summary columns
  // (borrower_name, property_address, ...) sync from the field values by trigger.
  const intakeRaw: Record<string, unknown> = { ...(fields.fields ?? {}) };
  if (fields.loan_type_key) {
    intakeRaw.loan_program = PROGRAM_LABEL[fields.loan_type_key] ?? fields.loan_type_key.toUpperCase();
  }
  if (fields.notes) intakeRaw.loan_request_summary = fields.notes;
  if (Object.keys(intakeRaw).length) {
    const { data: defRows } = await admin.from("field_definitions").select("key,type,source");
    const defs = Object.fromEntries(
      (defRows ?? []).map((d) => [d.key, { type: d.type as string, source: d.source as string | null }]),
    );
    await writeIntakeFields(admin, loanId, intakeRaw, defs);
    try {
      await recomputeLoan(loanId);
    } catch {
      /* calc is best-effort */
    }
    await logEvent(admin, {
      loanId,
      actorKind: "ai",
      eventType: "intake_recorded",
      payload: { fields: Object.keys(intakeRaw) },
    });
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
  await logEvent(admin, { loanId, actorId: user.id, eventType: "quote_posted" });
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
    .select("loan_number,opportunity_number,custom_fields")
    .eq("id", loanId)
    .single();
  if (!loan) return { ok: false, error: "No access to this loan." };

  const cf = (loan.custom_fields as Record<string, unknown>) ?? {};
  if (!cf.quote) return { ok: false, error: "There's no quote on file to turn into a term sheet yet." };
  const ref = loan.loan_number ?? loan.opportunity_number; // SPHX once signed, OPP before

  const body =
    "Here is your Letter of Intent / term sheet based on the quoted terms. Please open and review it, " +
    "then sign below to accept and begin the process. Final terms remain subject to underwriting and approval.";

  const admin = createServiceRoleClient();

  // Stamp the term sheet date to today; updates on each (re)generation.
  await upsertFieldValue(admin, {
    loanId,
    key: "term_sheet_date",
    valueKind: "initial",
    value: new Date().toISOString().slice(0, 10),
  });

  const { error } = await admin.from("messages").insert({
    loan_id: loanId,
    sender_kind: "ai",
    sender_role: "ai",
    is_internal: false,
    body,
    payload: {
      sign: true,
      doc: { title: `Letter of Intent — ${ref}.pdf`, url: `/api/loans/${loanId}/term-sheet` },
    },
  });
  if (error) return { ok: false, error: error.message };
  await logEvent(admin, { loanId, actorId: user?.id ?? null, eventType: "term_sheet_generated" });
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
    .select("loan_number,opportunity_number,property_address,custom_fields")
    .eq("id", loanId)
    .single();
  if (!loan) return { ok: false, error: "No access to this loan." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
  const name = profile?.full_name || profile?.email || "Signer";
  const email = profile?.email || user.email || "";
  const now = new Date();

  const admin = createServiceRoleClient();

  // Opportunity -> loan: on first signature, assign the permanent SPHX loan number.
  // Idempotent and grandfather-safe — returns the existing number if one is set.
  const wasNewNumber = !loan.loan_number;
  let loanNumber = loan.loan_number;
  if (!loanNumber) {
    const { data: assigned } = await admin.rpc("assign_loan_number", { p_loan_id: loanId });
    loanNumber = (assigned as string | null) ?? loan.opportunity_number;
  }

  // On first signing (the SPHX number was just assigned), add a row to the org
  // "Loan Tracker" sheet: [Address, Loan Number]. Best-effort — never block signing.
  if (wasNewNumber && loanNumber && sheetsConfigured()) {
    try {
      await appendSheetRow(LOAN_TRACKER_SHEET_ID, "Loan Number Tracker", [
        loan.property_address ?? "",
        loanNumber,
      ]);
    } catch {
      /* ignore tracker failures */
    }
  }

  const custom = {
    ...((loan.custom_fields as Record<string, unknown>) ?? {}),
    term_sheet: { signed_by: name, signed_at: now.toISOString(), ip, email },
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
        title: `Letter of Intent — ${loanNumber} (signed).pdf`,
        url: `/api/loans/${loanId}/term-sheet`,
      },
    },
  });
  if (error) return { ok: false, error: error.message };
  await logEvent(admin, {
    loanId,
    actorId: user.id,
    eventType: "term_sheet_signed",
    payload: { loan_number: loanNumber, signed_by: name },
  });
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

  const idx = input.idx ?? 1;
  const valueKind = input.valueKind ?? "initial";
  const col = valueKind === "verified" ? "verified_value" : "initial_value";

  // Capture the old value so the activity log can show before → after.
  const { data: prev } = await supabase
    .from("loan_field_values")
    .select("initial_value,verified_value")
    .eq("loan_id", input.loanId)
    .eq("field_key", input.key)
    .eq("idx", idx)
    .maybeSingle();
  const oldValue = prev ? (prev as Record<string, unknown>)[col] : undefined;

  const raw = normalizeFieldValue(input.key, input.type, input.value);
  const value = coerceForType(input.type, raw);
  const { error } = await upsertFieldValue(supabase, {
    loanId: input.loanId,
    key: input.key,
    idx,
    valueKind,
    value,
    actorId: user.id,
  });
  if (error) return { ok: false, error: error.message };

  // Log the change (internal) when the value actually changed.
  if (JSON.stringify(oldValue ?? null) !== JSON.stringify(value ?? null)) {
    await logEvent(createServiceRoleClient(), {
      loanId: input.loanId,
      actorId: user.id,
      eventType: "field_updated",
      isInternal: true,
      payload: {
        key: input.key,
        idx,
        old: oldValue ?? null,
        new: value ?? null,
      },
    });
  }

  // Recompute calculated fields from the new inputs (never blocks the save).
  try {
    await recomputeLoan(input.loanId);
  } catch {
    /* calc is best-effort */
  }
  // Live mirror into the loan's Google Sheet (app -> sheet). Best-effort; a Sheets error
  // must never fail the save. API writes don't trigger the sheet's onEdit, so no loop.
  try {
    await pushFieldsToSheet(input.loanId, [idx > 1 ? `${input.key}#${idx}` : input.key]);
  } catch {
    /* sheet sync is best-effort */
  }
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

/** Manually set a loan's stage (lending team only). Validates the stage and logs it. */
export async function setLoanStage(input: {
  loanId: string;
  stage: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Role check and current-stage read are independent — run them together. The loan
  // read is RLS-gated to loans the caller can access.
  const [{ data: me }, { data: loan }] = await Promise.all([
    supabase.from("profiles").select("lender_user_type").eq("id", user.id).single(),
    supabase.from("loans").select("stage").eq("id", input.loanId).single(),
  ]);
  if (!me?.lender_user_type) return { ok: false, error: "Lending team only." };
  if (!STAGES.some((s) => s.key === input.stage)) return { ok: false, error: "Unknown stage." };
  if (!loan) return { ok: false, error: "No access to this loan." };
  if (loan.stage === input.stage) return { ok: true };

  const admin = createServiceRoleClient();
  const { error } = await admin.from("loans").update({ stage: input.stage }).eq("id", input.loanId);
  if (error) return { ok: false, error: error.message };

  await logEvent(admin, {
    loanId: input.loanId,
    actorId: user.id,
    eventType: "stage_changed",
    isInternal: true,
    payload: { old: loan.stage, new: input.stage },
  });
  return { ok: true };
}

/**
 * Set a loan's lifecycle status (active / on_hold / withdrawn / declined / archived) — the
 * disposition for a deal that isn't moving forward. Lending-team only; logs the change.
 * "archived" also drops the loan from the pipeline list (see src/app/page.tsx).
 */
export async function setLoanStatus(input: {
  loanId: string;
  status: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const [{ data: me }, { data: loan }] = await Promise.all([
    supabase.from("profiles").select("lender_user_type").eq("id", user.id).single(),
    supabase.from("loans").select("status").eq("id", input.loanId).single(),
  ]);
  if (!me?.lender_user_type) return { ok: false, error: "Lending team only." };
  if (!isLoanStatus(input.status)) return { ok: false, error: "Unknown status." };
  if (!loan) return { ok: false, error: "No access to this loan." };
  if (loan.status === input.status) return { ok: true };

  const admin = createServiceRoleClient();
  const { error } = await admin.from("loans").update({ status: input.status }).eq("id", input.loanId);
  if (error) return { ok: false, error: error.message };

  await logEvent(admin, {
    loanId: input.loanId,
    actorId: user.id,
    eventType: "status_changed",
    isInternal: true,
    payload: { old: loan.status, new: input.status },
  });
  return { ok: true };
}

// ---------- Internal notes (lending team only) ----------

/** Add a team-only note to a loan. RLS enforces lending-team + loan access. */
export async function addInternalNote(input: {
  loanId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string; note?: InternalNote }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Note is empty." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("internal_notes")
    .insert({ loan_id: input.loanId, author_id: user.id, body })
    .select("*, author:author_id(full_name,email)")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn’t save the note." };
  return { ok: true, note: data as InternalNote };
}

// ---------- Deal contacts (extra people on the People tab) ----------

/**
 * Replace the loan's free-form contact list (stored on custom_fields.contacts).
 * These are people without an app login — title/insurance/other contacts the team
 * tracks. Fixed contacts (title/insurance) live in the field store; this is for the
 * "add another" rows. Lending team only.
 */
export async function saveDealContacts(input: {
  loanId: string;
  contacts: DealContact[];
}): Promise<{ ok: boolean; error?: string }> {
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

  // RLS read confirms this user may access the loan before the service-role write.
  const { data: loan } = await supabase
    .from("loans")
    .select("custom_fields")
    .eq("id", input.loanId)
    .single();
  if (!loan) return { ok: false, error: "No access to this loan." };

  const clean = input.contacts
    .map((c) => ({
      id: String(c.id || crypto.randomUUID()),
      label: String(c.label ?? "").slice(0, 80),
      name: String(c.name ?? "").slice(0, 120),
      email: String(c.email ?? "").slice(0, 160),
      phone: String(c.phone ?? "").slice(0, 60),
    }))
    .filter((c) => c.label || c.name || c.email || c.phone);

  const admin = createServiceRoleClient();
  const custom = { ...((loan.custom_fields as Record<string, unknown>) ?? {}), contacts: clean };
  const { error } = await admin.from("loans").update({ custom_fields: custom }).eq("id", input.loanId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- Google Sheet mirror (P22, one-way push) ----------

/** Create (if needed) and refresh this loan's Google Sheet with its field values. */
export async function syncLoanToSheet(
  loanId: string,
): Promise<{ ok: boolean; error?: string; url?: string }> {
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
  if (!sheetsConfigured())
    return { ok: false, error: "Google Sheets isn't configured yet (GOOGLE_SERVICE_ACCOUNT_JSON)." };

  // Push the loan's field values into its DSCR dashboard's mapped cells (app -> sheet).
  try {
    const { url } = await syncLoanToDashboard(loanId);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Dashboard sync failed." };
  }
}

/**
 * Pull the loan's Google Sheet into the app (sheet -> app), reconciling every mapped input
 * cell (last-writer-wins, blanks ignored). Lender only. Called on open and on a light timer
 * while a loan is viewed, so sheet edits land without any per-sheet Apps Script trigger.
 */
export async function pullFromSheet(loanId: string): Promise<{ ok: boolean; changed?: number; error?: string }> {
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

  try {
    const { changed } = await reconcileLoanSheet(loanId);
    return { ok: true, changed: changed.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Pull failed." };
  }
}

// ---------- Per-loan checklist (P18) ----------

/** Instantiate a loan's checklist from its program's checklist (idempotent). */
export async function createLoanChecklist(
  loanId: string,
): Promise<{ ok: boolean; error?: string; created?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: loan } = await supabase.from("loans").select("program_id").eq("id", loanId).single();
  if (!loan) return { ok: false, error: "No access to this loan." };
  if (!loan.program_id) return { ok: false, error: "This loan has no program set yet." };

  const admin = createServiceRoleClient();
  const { data: items } = await admin
    .from("program_checklist_items")
    .select("document_type_id")
    .eq("program_id", loan.program_id);
  if (!items?.length) return { ok: false, error: "No checklist is configured for this program." };

  const rows = items.map((i) => ({ loan_id: loanId, document_type_id: i.document_type_id, status: "outstanding" }));
  const { error } = await admin
    .from("loan_checklist_items")
    .upsert(rows, { onConflict: "loan_id,document_type_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, created: rows.length };
}

/** Update a checklist item's status/notes (lending team) and log it to audit_events. */
export async function setChecklistItemStatus(input: {
  loanId: string;
  itemId: string;
  status: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: before } = await supabase
    .from("loan_checklist_items")
    .select("status,document_type_id")
    .eq("id", input.itemId)
    .single();

  const patch: Record<string, unknown> = { status: input.status, updated_by: user.id, updated_at: new Date().toISOString() };
  if (input.notes !== undefined) patch.notes = input.notes;
  const { error } = await supabase.from("loan_checklist_items").update(patch).eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };

  const admin = createServiceRoleClient();
  await admin.from("audit_events").insert({
    loan_id: input.loanId,
    actor_id: user.id,
    actor_kind: "human",
    event_type: "checklist_status",
    is_internal: false,
    payload: {
      item_id: input.itemId,
      document_type_id: before?.document_type_id,
      old: before?.status,
      new: input.status,
    },
  });
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

  let answer: Awaited<ReturnType<typeof answerLoanQuestion>>;
  try {
    answer = await answerLoanQuestion({ supabase, loanId, question, isLender });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }

  // null = caller has no access to this loan; do not persist anything.
  if (answer === null) return { ok: false, error: "No access to this loan." };

  // When the AI proposed record changes (lender only), attach them to the message as a
  // Confirm/Cancel card. Nothing is written until the user confirms (see applyLoanUpdates).
  const payload = answer.proposal
    ? {
        updates: {
          summary: answer.proposal.summary,
          fields: answer.proposal.fieldUpdates,
          stage: answer.proposal.stage,
          checklist: answer.proposal.checklistUpdates,
        },
      }
    : null;

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
    body: answer.text,
    payload,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Apply AI-proposed record changes after the user confirms them on the chat card
 * (R-CHAT). Lending team only. Each change is re-validated and routed through the same
 * server actions the UI uses (field save + recompute, stage change, checklist status),
 * so the AI can never do more than the lender could do by hand. Posts a confirmation
 * message summarizing what was applied.
 */
export async function applyLoanUpdates(input: {
  loanId: string;
  updates: {
    summary?: string;
    fields: { key: string; label: string; value: string }[];
    stage: { key: string; label: string } | null;
    checklist: { document: string; status: string }[];
  };
}): Promise<{ ok: boolean; error?: string }> {
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

  const { loanId, updates } = input;
  const applied: string[] = [];
  const failed: string[] = [];

  // Field values — only user-maintained fields (never calculated/system).
  const keys = (updates.fields ?? []).map((f) => f.key);
  if (keys.length) {
    const admin = createServiceRoleClient();
    const { data: defs } = await admin
      .from("field_definitions")
      .select("key,type,source,options")
      .in("key", keys);
    const defMap = new Map(
      (defs ?? []).map((d) => [d.key, d as { type: string; source: string | null; options: string[] | null }]),
    );
    // The displayed value is verified ?? initial. To make the change actually show, write
    // to whichever kind is currently active: verified if one exists, otherwise initial.
    const { data: existing } = await admin
      .from("loan_field_values")
      .select("field_key,verified_value")
      .eq("loan_id", loanId)
      .eq("idx", 1)
      .in("field_key", keys);
    const hasVerified = new Set(
      (existing ?? [])
        .filter((r) => r.verified_value != null && r.verified_value !== "")
        .map((r) => r.field_key),
    );
    for (const f of updates.fields) {
      const def = defMap.get(f.key);
      if (!def) {
        failed.push(`${f.label || f.key} (unknown field)`);
        continue;
      }
      if (def.source === "calculated" || def.source === "system") {
        failed.push(`${f.label} (calculated — can't be edited)`);
        continue;
      }
      // A dropdown field only accepts one of its options — otherwise it saves a value the
      // UI can't display. Match case-insensitively and store the option's canonical casing.
      let value = f.value;
      if (def.type === "select" && def.options?.length) {
        const match = def.options.find((o) => o.toLowerCase() === f.value.trim().toLowerCase());
        if (!match) {
          failed.push(`${f.label} (“${f.value}” must be one of: ${def.options.join(", ")})`);
          continue;
        }
        value = match;
      }
      const valueKind = hasVerified.has(f.key) ? "verified" : "initial";
      const res = await saveLoanField({ loanId, key: f.key, type: def.type, value, valueKind });
      if (res.ok) applied.push(`${f.label} → ${value}`);
      else failed.push(`${f.label} (${res.error})`);
    }
  }

  // Stage.
  if (updates.stage) {
    const res = await setLoanStage({ loanId, stage: updates.stage.key });
    if (res.ok) applied.push(`Stage → ${updates.stage.label}`);
    else failed.push(`Stage (${res.error})`);
  }

  // Document checklist statuses — resolve each document name to its item.
  if (updates.checklist?.length) {
    const { data: loan } = await supabase.from("loans").select("program_id").eq("id", loanId).single();
    const checklist = await loadLoanChecklist(supabase, loanId, loan?.program_id ?? null);
    const byName = new Map(checklist.map((c) => [c.name.toLowerCase(), c]));
    const STATUS_LABEL: Record<string, string> = {
      outstanding: "Outstanding",
      ordered: "Ordered",
      update_needed: "Update needed",
      approved: "Approved",
      not_applicable: "N/A",
    };
    for (const c of updates.checklist) {
      const item = byName.get(c.document.trim().toLowerCase());
      if (!item) {
        failed.push(`${c.document} (no such document)`);
        continue;
      }
      const res = await setChecklistItemStatus({ loanId, itemId: item.id, status: c.status });
      if (res.ok) applied.push(`${item.name} → ${STATUS_LABEL[c.status] ?? c.status}`);
      else failed.push(`${item.name} (${res.error})`);
    }
  }

  // Post a confirmation of what landed. Lender exchange stays team-only.
  const parts: string[] = [];
  if (applied.length) parts.push(`Done — ${applied.join("; ")}.`);
  if (failed.length) parts.push(`Couldn’t apply: ${failed.join("; ")}.`);
  const body = parts.join(" ") || "No changes were applied.";
  const admin = createServiceRoleClient();
  await admin.from("messages").insert({
    loan_id: loanId,
    sender_kind: "ai",
    sender_role: "ai",
    is_internal: true,
    body,
  });

  if (!applied.length && failed.length) return { ok: false, error: failed.join("; ") };
  return { ok: true };
}
