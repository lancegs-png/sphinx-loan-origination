"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  coerceForType,
  setFieldLockRow,
  upsertFieldValue,
  writeIntakeFields,
} from "@/lib/fields";
import { recomputeLoan } from "@/lib/calc";
import { sheetsConfigured, appendSheetRow, LOAN_TRACKER_SHEET_ID } from "@/lib/google/sheets";
import { syncLoanToDashboard } from "@/lib/google/dashboard";
import { pushFieldsToSheet, reconcileLoanSheet } from "@/lib/google/sheet-sync";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { generateTempPassword, resetTempPassword } from "@/lib/users";
import { logEvent, loadLoanActivity, type ActivityEvent } from "@/lib/audit";
import { answerLoanQuestion } from "@/lib/ai/record-keeper";
import { loadLoanChecklist } from "@/lib/checklist";
import { openDeal } from "@/lib/loans/open-deal";
import { getActiveLink, isRateLimited, recordSubmission, newLinkToken } from "@/lib/intake/links";
import { notifyBrokerOfSubmission } from "@/lib/intake/broker-notify";
import {
  getActiveApplicationLink,
  ensureApplicationLink,
  isApplicationRateLimited,
  recordApplicationSubmission,
  markApplicationLinkCompleted,
} from "@/lib/application/links";
import { APPLICATION_CONTROL_KEYS, coguarantorDictKey } from "@/lib/application/form-spec";
import { fillApplicationPdf } from "@/lib/application/pdf-fill";
import { placeSignedApplication } from "@/lib/application/documents";
import { loadFieldDefs } from "@/lib/field-defs";
import { sendMail } from "@/lib/email";
import { STAGES } from "@/lib/stages";
import { isLoanStatus } from "@/lib/status";
import type { QuoteField } from "@/lib/program-ai-config";
import type { DealContact, InternalNote, FieldValues } from "@/lib/types";

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
  guarantorIds?: string[];
  entityId?: string | null;
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
      guarantorIds: input.guarantorIds ?? [],
      entityId: input.entityId ?? null,
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
 * Create a deal from a native intake-form submission (manual entry, Phase 1). Opens an
 * Opportunity (OPP#, Intake stage) via the shared `openDeal`, which derives the program,
 * stores the immutable Intake Form Data snapshot, and seeds the submitted field values.
 * `values` are the form's dictionary-keyed answers. See docs/intake-crm-design.md.
 */
export async function createIntakeDeal(
  values: Record<string, string>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
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

  // Keep only the non-empty answers.
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) clean[k] = t;
  }

  const street = clean.property_street ?? "";
  const first = clean.guarantor_first_name ?? "";
  const last = clean.guarantor_last_name ?? "";
  if (!street) return { ok: false, error: "Enter the property street address" };
  if (!first && !last && !clean.borrower_entity) {
    return { ok: false, error: "Enter the borrower name or entity" };
  }

  const address = [
    street,
    [clean.property_city, [clean.property_state, clean.property_zip].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join(", ");

  try {
    const result = await openDeal(createServiceRoleClient(), {
      address,
      guarantorFirst: first,
      guarantorLast: last,
      stage: "intake",
      createdByUserId: user.id,
      accountManagerId: profile.lender_user_type === "account_manager" ? user.id : null,
      intake: clean,
    });
    return { ok: true, id: result.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the deal" };
  }
}

/**
 * Public intake submission (Phase 3). Called with no auth from the shared /apply/<token>
 * form. Validates the link, drops bots via the honeypot, rate-limits per link, then opens an
 * Opportunity (service role) attributed to the link's owner. Returns success without the loan
 * id — the public submitter can't see the deal. See docs/intake-crm-design.md §8.
 */
export async function submitPublicIntake(input: {
  token: string;
  values: Record<string, string>;
  website?: string; // honeypot — real users never fill this
}): Promise<{ ok: boolean; error?: string }> {
  const link = await getActiveLink(input.token);
  if (!link) return { ok: false, error: "This link is no longer active." };

  // Honeypot: a bot filled the hidden field. Pretend success and drop it silently.
  if ((input.website ?? "").trim() !== "") return { ok: true };

  if (await isRateLimited(input.token)) {
    return { ok: false, error: "We've received several submissions from this link recently. Please try again shortly." };
  }

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.values ?? {})) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) clean[k] = t;
  }
  if (!clean.property_street) return { ok: false, error: "Enter the property street address" };
  if (!clean.guarantor_first_name && !clean.guarantor_last_name && !clean.borrower_entity) {
    return { ok: false, error: "Enter the borrower name or entity" };
  }

  // Attribution from the link overrides whatever the form carried.
  clean.source_channel =
    link.owner_type === "broker" ? "broker" : link.owner_type === "referral_partner" ? "referral_partner" : "direct";
  if (link.owner_type !== "sphinx_originator") {
    if (link.owner_name) clean.broker_name = link.owner_name;
    if (link.owner_email) clean.broker_email = link.owner_email;
  }

  const address = [
    clean.property_street,
    [clean.property_city, [clean.property_state, clean.property_zip].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join(", ");

  // A broker's own shareable link ties the deal to that broker: add them as a 'broker' participant
  // (via createdByRole) so it lands in their pipeline, and set the loan's created_by to them.
  const isBrokerLink = link.owner_type === "broker" && !!link.owner_user_id;
  try {
    const result = await openDeal(createServiceRoleClient(), {
      address,
      guarantorFirst: clean.guarantor_first_name ?? "",
      guarantorLast: clean.guarantor_last_name ?? "",
      stage: "intake",
      createdByUserId: isBrokerLink ? link.owner_user_id : null,
      createdByRole: isBrokerLink ? "broker" : undefined,
      accountManagerId: link.owner_type === "sphinx_originator" ? link.owner_user_id : null,
      intake: clean,
    });
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await recordSubmission(link.id, link.token, result.id, ip);
    // Notify the broker whose shareable link brought the deal in, with a copy of the responses.
    if (link.owner_type === "broker" && link.owner_email) {
      const ownerEmail = link.owner_email;
      const host = h.get("host");
      const proto = h.get("x-forwarded-proto") ?? "https";
      await notifyBrokerOfSubmission({
        ownerName: link.owner_name,
        ownerEmail,
        loanRef: result.opportunity_number ?? result.loan_number ?? result.id,
        loanUrl: host ? `${proto}://${host}/loans/${result.id}` : null,
        values: clean,
      }).catch(() => {});
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong submitting the form. Please try again." };
  }
}

/**
 * Public borrower Loan Application submission (post-term-sheet). Called with no auth from
 * /application/<token>. Validates the link, drops bots, rate-limits, then writes the overlapping
 * answers back onto the EXISTING loan (service role) and saves the full submission as a snapshot.
 * E-signature + the completed PDF + the Documents hand-off are added in phase 3.
 */
export async function submitApplication(input: {
  token: string;
  values: Record<string, string>;
  website?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const link = await getActiveApplicationLink(input.token);
  if (!link) return { ok: false, error: "This link is no longer active." };
  if ((input.website ?? "").trim() !== "") return { ok: true }; // honeypot
  if (await isApplicationRateLimited(input.token)) {
    return { ok: false, error: "We've received several submissions from this link recently. Please try again shortly." };
  }

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.values ?? {})) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) clean[k] = t;
  }

  const admin = createServiceRoleClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Typed e-signatures — captured for the authentication certificate, not stored as loan fields.
  const signer = (clean.sig_guarantor_name ?? "").trim();
  const cosigner = (clean.sig_coguarantor_name ?? "").trim() || null;
  if (!signer) return { ok: false, error: "Please type your name to sign the application." };

  try {
    // Partition: drop form-only controls + signature/ack fields; co-guarantor -> guarantor idx 2;
    // declarations -> snapshot; everything else -> the dictionary at idx 1.
    const primary: Record<string, string> = {};
    const coguarantor: Record<string, string> = {};
    const declarations: Record<string, string> = {};
    for (const [k, v] of Object.entries(clean)) {
      if (APPLICATION_CONTROL_KEYS.has(k) || k.startsWith("sig_") || k.startsWith("ack_")) continue;
      if (k.startsWith("decl_")) {
        declarations[k] = v;
        continue;
      }
      const cogKey = coguarantorDictKey(k);
      if (cogKey) {
        coguarantor[cogKey] = v;
        continue;
      }
      primary[k] = v;
    }

    const defRows = await loadFieldDefs();
    const defs: Record<string, { type: string; source: string | null }> = {};
    for (const d of defRows) defs[d.key] = { type: d.type, source: d.source };

    // Primary answers at idx 1 (writeIntakeFields coerces by type + skips calculated/unknown keys).
    await writeIntakeFields(admin, link.loan_id, primary, defs);

    // Co-guarantor at idx 2.
    for (const [key, raw] of Object.entries(coguarantor)) {
      const def = defs[key];
      if (!def || def.source === "calculated") continue;
      const value = coerceForType(def.type, raw);
      if (value === null) continue;
      await upsertFieldValue(admin, { loanId: link.loan_id, key, idx: 2, valueKind: "initial", value });
    }

    // Merge the full snapshot + the signature record onto the loan (don't clobber other custom_fields).
    const { data: loanRow } = await admin
      .from("loans")
      .select("custom_fields,loan_number,opportunity_number")
      .eq("id", link.loan_id)
      .maybeSingle();
    const loanRef = loanRow?.loan_number ?? loanRow?.opportunity_number ?? link.loan_id;
    const signedAt = new Date();
    const custom = (loanRow?.custom_fields ?? {}) as Record<string, unknown>;
    custom.application_snapshot = {
      submitted_at: signedAt.toISOString(),
      source: "application_form",
      values: clean,
      declarations,
    };
    custom.application = {
      signed_by: signer,
      cosigned_by: cosigner,
      signed_at: signedAt.toISOString(),
      ip,
      email: clean.guarantor_email ?? "",
    };
    await admin.from("loans").update({ custom_fields: custom }).eq("id", link.loan_id);

    // Refresh derived fields from the new inputs (best-effort).
    try {
      await recomputeLoan(link.loan_id);
    } catch {
      /* non-fatal */
    }

    // Fill + flatten the application PDF with an authentication certificate, then drop it into the
    // "Loan application" Documents slot and mark it Yellow ("Ready for Review").
    const pdfBytes = await fillApplicationPdf(clean, {
      loanRef,
      guarantorSigner: signer,
      coguarantorSigner: cosigner,
      email: clean.guarantor_email ?? "",
      ip,
      signedAt,
      sentTo: clean.guarantor_email ?? null,
    });
    await placeSignedApplication(admin, link.loan_id, pdfBytes, `Loan Application - ${loanRef} (signed).pdf`);

    await recordApplicationSubmission(link.id, link.token, link.loan_id, ip);
    await markApplicationLinkCompleted(link.id);
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong submitting the application. Please try again." };
  }
}

/**
 * Lending-team action: generate (or reuse) the borrower's per-loan application link and email it to
 * them. Allowed once the term sheet is signed.
 */
export async function sendBorrowerApplication(
  loanId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const auth = await requireLender();
  if ("error" in auth) return { ok: false, error: auth.error };

  const admin = createServiceRoleClient();
  const { data: loan } = await admin.from("loans").select("custom_fields").eq("id", loanId).maybeSingle();
  const signedAt = (loan?.custom_fields as { term_sheet?: { signed_at?: string } } | null)?.term_sheet?.signed_at;
  if (!signedAt) return { ok: false, error: "Send the application after the term sheet is signed." };

  // Borrower email from the loan's field values (prefer borrower_email, fall back to guarantor_email).
  const { data: fv } = await admin
    .from("loan_field_values")
    .select("field_key,initial_value,verified_value")
    .eq("loan_id", loanId)
    .eq("idx", 1)
    .in("field_key", ["borrower_email", "guarantor_email"]);
  const emailOf = (key: string): string => {
    const r = (fv ?? []).find((x) => x.field_key === key);
    const v = r?.verified_value ?? r?.initial_value;
    return v ? String(v) : "";
  };
  const borrowerEmail = emailOf("borrower_email") || emailOf("guarantor_email");
  if (!borrowerEmail) return { ok: false, error: "No borrower email on file for this loan." };

  const linkRow = await ensureApplicationLink(loanId, auth.userId);
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = host ? `${proto}://${host}/application/${linkRow.token}` : `/application/${linkRow.token}`;

  const subject = "Complete your Sphinx Capital loan application";
  const text = [
    "Your term sheet is signed — the next step is your full loan application.",
    "",
    "We've pre-filled everything we already have; please review it and complete the rest:",
    url,
    "",
    "This secure link is unique to your loan.",
  ].join("\n");
  const html = `<div style="max-width:560px;margin:0 auto;font:14px system-ui,sans-serif;color:#111">
  <p>Your term sheet is signed — the next step is your full loan application.</p>
  <p>We&apos;ve pre-filled everything we already have; please review it and complete the rest.</p>
  <p><a href="${url}" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Complete your application →</a></p>
  <p style="color:#888;font-size:12px">This secure link is unique to your loan.</p>
</div>`;

  const res = await sendMail({ to: borrowerEmail, subject, html, text });
  await logEvent(admin, {
    loanId,
    actorId: auth.userId,
    eventType: "application_sent",
    payload: { token: linkRow.token, emailed: res.ok },
  });
  if (!res.ok) {
    const why = res.skipped ? "email isn't configured" : res.error ?? "the email failed";
    return { ok: false, url, error: `Link created, but ${why}. Link: ${url}` };
  }
  return { ok: true, url };
}

/** Confirm the caller is lending team; returns their user id or an error. */
async function requireLender(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();
  if (!profile?.lender_user_type) return { error: "Lending team only" };
  return { userId: user.id };
}

/** Create or update a shareable intake link (Settings → Intake Links). Lending team only. */
export async function saveIntakeLink(input: {
  id?: string;
  label: string;
  owner_type: "sphinx_originator" | "broker" | "referral_partner";
  owner_user_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  branding: "sphinx" | "white_label";
}): Promise<{ ok: boolean; error?: string; token?: string }> {
  const auth = await requireLender();
  if ("error" in auth) return { ok: false, error: auth.error };

  const label = input.label.trim();
  if (!label) return { ok: false, error: "Enter a label" };
  const isSphinx = input.owner_type === "sphinx_originator";
  if (isSphinx && !input.owner_user_id) return { ok: false, error: "Pick the Sphinx originator" };
  if (!isSphinx && !(input.owner_name ?? "").trim()) return { ok: false, error: "Enter the partner's name" };

  const row = {
    label,
    owner_type: input.owner_type,
    owner_user_id: isSphinx ? input.owner_user_id ?? null : null,
    owner_name: isSphinx ? null : (input.owner_name ?? "").trim() || null,
    owner_email: isSphinx ? null : (input.owner_email ?? "").trim() || null,
    branding: input.branding,
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("intake_links").update(row).eq("id", input.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const token = newLinkToken();
  const { error } = await supabase
    .from("intake_links")
    .insert({ ...row, token, active: true, created_by: auth.userId });
  return error ? { ok: false, error: error.message } : { ok: true, token };
}

/** Activate or deactivate a link. Lending team only. */
export async function setIntakeLinkActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireLender();
  if ("error" in auth) return { ok: false, error: auth.error };
  const supabase = await createClient();
  const { error } = await supabase.from("intake_links").update({ active }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Delete a link entirely. Lending team only. */
export async function deleteIntakeLink(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireLender();
  if ("error" in auth) return { ok: false, error: auth.error };
  const supabase = await createClient();
  const { error } = await supabase.from("intake_links").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---------- M4: DSCR quoting ----------
import { priceLoan, type PricingConfig, type QuoteInput, type QuoteResult } from "@/lib/pricing/engine";
import { priceSimple, simpleModelFrom } from "@/lib/pricing/simple";
import {
  priceQuote,
  type GeneralConfig,
  type InvestorFamily,
  type InvestorQuote,
  type QuoteParams,
} from "@/lib/pricing/general";

/** The single DSCR loan program's id — the two investor engines live on its pricing row. */
async function dscrProgramId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase
    .from("loan_programs")
    .select("id")
    .eq("loan_type_key", "dscr")
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/** Light shape guard for a parsed engine posted back from the admin upload UI. */
function isEngineShape(e: unknown, family: InvestorFamily): e is GeneralConfig {
  if (!e || typeof e !== "object") return false;
  const c = e as Record<string, unknown>;
  return (
    c.family === family &&
    typeof c.base_curves === "object" &&
    typeof c.grids === "object" &&
    typeof c.min_price === "number"
  );
}

/**
 * Admin: publish a parsed investor sizer as the live pricing engine for that investor. The two
 * engines live side-by-side under the DSCR program's program_pricing.model.engines; this merges
 * in one without disturbing the other or any existing guidelines.
 */
export async function publishInvestorPricing(input: {
  investor: InvestorFamily;
  engine: GeneralConfig;
}): Promise<{ ok: boolean; error?: string; effectiveDate?: string | null }> {
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
  if (!isEngineShape(input.engine, input.investor))
    return { ok: false, error: "Engine payload failed validation." };

  const programId = await dscrProgramId(supabase);
  if (!programId) return { ok: false, error: "No DSCR loan program exists to attach pricing to." };

  const { data: row } = await supabase
    .from("program_pricing")
    .select("guidelines,model")
    .eq("program_id", programId)
    .maybeSingle();

  const model = { ...((row?.model as Record<string, unknown>) ?? {}) };
  const engines = { ...((model.engines as Record<string, unknown>) ?? {}) };
  engines[input.investor] = input.engine;
  model.engines = engines;
  const published = { ...((model.engines_published as Record<string, unknown>) ?? {}) };
  published[input.investor] = {
    at: new Date().toISOString(),
    effective: input.engine.effective_date,
    file: input.engine.source_file,
    by: user.id,
  };
  model.engines_published = published;

  const { error } = await supabase.from("program_pricing").upsert(
    {
      program_id: programId,
      mode: "model",
      guidelines: (row?.guidelines as string | null) ?? null,
      model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, effectiveDate: input.engine.effective_date };
}

export type DualQuote = {
  quotes: InvestorQuote[];
  best: InvestorFamily | null; // highest eligible net price
  availableInvestors: InvestorFamily[];
  publishedMeta: Record<string, { effective: string | null; at: string }>;
};

/**
 * Price a loan scenario through every investor that has a published engine (Eastview,
 * Deephaven), for the side-by-side Quote tab. The best execution — highest eligible net price —
 * is flagged. Lending-team only.
 */
export async function dualQuote(
  params: QuoteParams,
): Promise<{ ok: boolean; result?: DualQuote; error?: string }> {
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

  const programId = await dscrProgramId(supabase);
  if (!programId) return { ok: false, error: "No DSCR loan program configured." };

  const { data: row } = await supabase
    .from("program_pricing")
    .select("model")
    .eq("program_id", programId)
    .maybeSingle();
  const model = (row?.model as Record<string, unknown> | null) ?? {};
  const engines = (model.engines as Partial<Record<InvestorFamily, GeneralConfig>>) ?? {};
  const publishedRaw = (model.engines_published as Record<string, { effective: string | null; at: string }>) ?? {};

  const families: InvestorFamily[] = ["eastview", "deephaven"];
  const quotes: InvestorQuote[] = [];
  const available: InvestorFamily[] = [];
  for (const fam of families) {
    const eng = engines[fam];
    if (!eng) continue;
    available.push(fam);
    quotes.push(priceQuote(eng, params));
  }
  if (quotes.length === 0)
    return { ok: false, error: "No investor pricing has been uploaded yet — add a sizer in Settings → Pricing." };

  let best: InvestorFamily | null = null;
  let bestPrice = -Infinity;
  for (const q of quotes) {
    if (q.eligible && q.netPrice != null && q.netPrice > bestPrice) {
      bestPrice = q.netPrice;
      best = q.family;
    }
  }

  const publishedMeta: Record<string, { effective: string | null; at: string }> = {};
  for (const fam of available)
    if (publishedRaw[fam]) publishedMeta[fam] = { effective: publishedRaw[fam].effective, at: publishedRaw[fam].at };

  return { ok: true, result: { quotes, best, availableInvestors: available, publishedMeta } };
}

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

  // program_pricing is lending-team-readable, so the user session (already checked above)
  // can read it — no service-role dependency.
  const { data: pricing } = await supabase
    .from("program_pricing")
    .select("model")
    .eq("program_id", loan.program_id)
    .single();
  const model = (pricing?.model as Record<string, unknown> | null) ?? null;
  const engine = (model as { engine?: PricingConfig } | null)?.engine;

  try {
    // DSCR (and any program with a parsed sizer) prices from its engine; every other program
    // prices from its configurable rate/fee grid set in Settings → Pricing.
    if (engine) return { ok: true, result: priceLoan(engine, input) };
    const simple = simpleModelFrom(model);
    if (simple) return { ok: true, result: priceSimple(simple, input) };
    return {
      ok: false,
      error: "This program has no pricing configured yet. Set a rate/fee model in Settings → the program → Pricing.",
    };
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
// Fields stored fully uppercased — entity / legal names (e.g. "HHH RENTALS 4 LLC").
const UPPERCASE_FIELDS = new Set(["borrower_entity"]);

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
  if (UPPERCASE_FIELDS.has(key)) return t.toUpperCase();
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

  // Recompute calculated fields from the new inputs (never blocks the save). Reuse the returned
  // values for the sheet push so we don't reload loan_field_values a second time.
  let recomputed: FieldValues | undefined;
  try {
    recomputed = await recomputeLoan(input.loanId);
  } catch {
    /* calc is best-effort */
  }
  // Live mirror into the loan's Google Sheet (app -> sheet). Best-effort; a Sheets error
  // must never fail the save. API writes don't trigger the sheet's onEdit, so no loop.
  try {
    await pushFieldsToSheet(input.loanId, [idx > 1 ? `${input.key}#${idx}` : input.key], recomputed);
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

/** Load a loan's internal notes — lender-only. The Notes tab fetches these on open so they're
 *  not part of the loan page's initial load. */
export async function fetchLoanNotes(loanId: string): Promise<InternalNote[]> {
  const auth = await requireLender();
  if ("error" in auth) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("internal_notes")
    .select("*, author:author_id(full_name,email)")
    .eq("loan_id", loanId)
    .order("created_at", { ascending: true });
  return (data as InternalNote[]) ?? [];
}

/** Load a loan's activity log — lender-only. The Activity tab fetches this on open so it's not
 *  part of the loan page's initial load. */
export async function fetchLoanActivity(loanId: string): Promise<ActivityEvent[]> {
  const auth = await requireLender();
  if ("error" in auth) return [];
  const supabase = await createClient();
  return loadLoanActivity(supabase, loanId);
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

// ---------- Per-loan stage-task checklist (customizable per program) ----------

/**
 * Toggle a stage-task's done state and/or its note for a loan (lending team only).
 * Upserts the per-loan status row keyed by (loan_id, task_id), stamps who/when on
 * completion, and logs an internal audit event when the done state actually changes.
 */
export async function setLoanTaskStatus(input: {
  loanId: string;
  taskId: string;
  done?: boolean;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: before } = await supabase
    .from("loan_task_status")
    .select("done")
    .eq("loan_id", input.loanId)
    .eq("task_id", input.taskId)
    .maybeSingle();

  const now = new Date().toISOString();
  const row: Record<string, unknown> = { loan_id: input.loanId, task_id: input.taskId, updated_at: now };
  if (input.done !== undefined) {
    row.done = input.done;
    row.completed_by = input.done ? user.id : null;
    row.completed_at = input.done ? now : null;
  }
  if (input.note !== undefined) row.note = input.note.trim() || null;

  const { error } = await supabase
    .from("loan_task_status")
    .upsert(row, { onConflict: "loan_id,task_id" });
  if (error) return { ok: false, error: error.message };

  if (input.done !== undefined && input.done !== (before?.done ?? false)) {
    const { data: task } = await supabase
      .from("program_stage_tasks")
      .select("label")
      .eq("id", input.taskId)
      .maybeSingle();
    const admin = createServiceRoleClient();
    await admin.from("audit_events").insert({
      loan_id: input.loanId,
      actor_id: user.id,
      actor_kind: "human",
      event_type: "stage_task_status",
      is_internal: true,
      payload: { task_id: input.taskId, label: task?.label, done: input.done },
    });
  }
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

export type UserType = "borrower" | "originator" | "broker" | "account_manager" | "operations" | "admin";

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
  const tempPassword = generateTempPassword();

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

/**
 * Admin: deactivate or reactivate a user. Deactivating bans them in auth so they can't sign
 * in (reversible) while keeping the account and all their attribution intact; reactivating
 * lifts the ban. Admin only, and you can't deactivate your own account.
 */
export async function setUserActive(input: {
  userId: string;
  active: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (input.userId === user.id) return { ok: false, error: "You can't deactivate your own account." };
  const { data: me } = await supabase
    .from("profiles")
    .select("lender_user_type")
    .eq("id", user.id)
    .single();
  if (me?.lender_user_type !== "admin") return { ok: false, error: "Admins only." };

  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    // GoTrue ban: "none" lifts it; a long duration disables sign-in until reactivated.
    ban_duration: input.active ? "none" : "876000h",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Admin: reset an existing user's password to a fresh one-time temp password. The app sends
 * no email, so the returned password is shown once for the admin to hand over.
 */
export async function resetUserPassword(input: {
  userId: string;
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

  const res = await resetTempPassword(createServiceRoleClient(), { userId: input.userId });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, tempPassword: res.tempPassword };
}

/** Confirm the caller is a broker; returns their user id, name and email, or an error. */
async function requireBroker(): Promise<
  { userId: string; fullName: string | null; email: string } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("external_type, full_name, email")
    .eq("id", user.id)
    .single();
  if (profile?.external_type !== "broker") return { error: "Brokers only" };
  return {
    userId: user.id,
    fullName: (profile.full_name as string | null) ?? null,
    email: (profile.email as string) ?? user.email ?? "",
  };
}

/** This deployment's origin, from request headers (no site-url env is configured). */
async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${proto}://${host}` : null;
}

/**
 * Link a broker account to every existing loan that names their email as the broker
 * (loan_field_values.broker_email), by adding a 'broker' deal_participants row (idempotent).
 * Service role. Returns how many loans were newly linkable.
 */
async function linkBrokerToLoans(userId: string, email: string): Promise<number> {
  const target = email.trim().toLowerCase();
  if (!target) return 0;
  const admin = createServiceRoleClient();
  const { data: rows } = await admin
    .from("loan_field_values")
    .select("loan_id, initial_value, verified_value")
    .eq("field_key", "broker_email");
  const loanIds = Array.from(
    new Set(
      (rows ?? [])
        .filter((r) => {
          const v = (r.verified_value ?? r.initial_value) as unknown;
          return typeof v === "string" && v.trim().toLowerCase() === target;
        })
        .map((r) => r.loan_id as string),
    ),
  );
  if (!loanIds.length) return 0;
  const { error } = await admin.from("deal_participants").upsert(
    loanIds.map((loan_id) => ({ loan_id, user_id: userId, participant_role: "broker", added_by: userId })),
    { onConflict: "loan_id,user_id", ignoreDuplicates: true },
  );
  return error ? 0 : loanIds.length;
}

/**
 * Admin: invite a broker to the portal. Sends Supabase's invite email (a set-password link),
 * creates the account as external_type='broker', and links them to existing loans that name
 * their email. If invite email isn't configured, falls back to a one-time temp password for
 * the admin to hand over (the broker can also use the login page's magic link). Admin only.
 */
export async function inviteBroker(input: {
  fullName: string;
  email: string;
}): Promise<{ ok: boolean; error?: string; invited?: boolean; tempPassword?: string; linked?: number }> {
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
  const fullName = input.fullName.trim();
  if (!email) return { ok: false, error: "Email required." };

  const admin = createServiceRoleClient();
  const origin = await requestOrigin();
  const redirectTo = origin ? `${origin}/auth/callback?next=/update-password` : undefined;

  const markBroker = async (userId: string) => {
    await admin
      .from("profiles")
      .update({ full_name: fullName || null, external_type: "broker", is_lending_team: false, lender_user_type: null })
      .eq("id", userId);
    // Add/refresh this account in the reusable broker directory (unified with saved brokers).
    const { data: existing } = await admin.from("brokers").select("id").eq("user_id", userId).maybeSingle();
    if (existing?.id) {
      await admin.from("brokers").update({ name: fullName || null, email, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await admin.from("brokers").insert({ user_id: userId, name: fullName || null, email, created_by: userId });
    }
    return linkBrokerToLoans(userId, email);
  };

  // Preferred: send the invite email (also creates the auth account).
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName || null },
    redirectTo,
  });
  if (!inviteErr && invited?.user) {
    const linked = await markBroker(invited.user.id);
    return { ok: true, invited: true, linked };
  }

  // Fallback 1: the account already exists — (re)mark them a broker and link.
  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing?.id) {
    const linked = await markBroker(existing.id as string);
    return { ok: true, invited: false, linked, error: "That account already existed — updated to broker and linked." };
  }

  // Fallback 2: invite email likely not configured — create with a temp password to hand over.
  const tempPassword = generateTempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName || null },
  });
  if (createErr || !created?.user) {
    return { ok: false, error: inviteErr?.message ?? createErr?.message ?? "Could not invite broker." };
  }
  const linked = await markBroker(created.user.id);
  return { ok: true, invited: false, tempPassword, linked };
}

/**
 * Broker self-submission of the intake form (broker portal). Opens an Opportunity attributed to
 * the broker and adds them as a 'broker' participant so it appears in their pipeline. Brokers only.
 */
export async function submitBrokerIntake(
  values: Record<string, string>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const auth = await requireBroker();
  if ("error" in auth) return { ok: false, error: auth.error };

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) clean[k] = t;
  }
  const street = clean.property_street ?? "";
  if (!street) return { ok: false, error: "Enter the property street address" };
  if (!clean.guarantor_first_name && !clean.guarantor_last_name && !clean.borrower_entity) {
    return { ok: false, error: "Enter the borrower name or entity" };
  }

  // Attribution: the submitting broker.
  clean.source_channel = "broker";
  if (auth.fullName) clean.broker_name = auth.fullName;
  if (auth.email) clean.broker_email = auth.email;

  const address = [
    street,
    [clean.property_city, [clean.property_state, clean.property_zip].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join(", ");

  try {
    const result = await openDeal(createServiceRoleClient(), {
      address,
      guarantorFirst: clean.guarantor_first_name ?? "",
      guarantorLast: clean.guarantor_last_name ?? "",
      stage: "intake",
      createdByUserId: auth.userId,
      createdByRole: "broker",
      intake: clean,
    });
    return { ok: true, id: result.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not submit the deal" };
  }
}

/**
 * Broker portal: the broker's own shareable intake link. Returns the existing one or creates it
 * (service role, since intake_links is lending-team-only under RLS). A submission through this
 * link opens a deal attributed to this broker and adds them as a participant, so it lands in
 * their pipeline. White-label by default. Brokers only.
 */
export async function getMyBrokerIntakeLink(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const auth = await requireBroker();
  if ("error" in auth) return { ok: false, error: auth.error };

  const admin = createServiceRoleClient();
  const { data: existing } = await admin
    .from("intake_links")
    .select("token")
    .eq("owner_type", "broker")
    .eq("owner_user_id", auth.userId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.token) return { ok: true, token: existing.token as string };

  const token = newLinkToken();
  const label = `${auth.fullName || auth.email || "Broker"} — intake link`;
  const { error } = await admin.from("intake_links").insert({
    token,
    label,
    owner_type: "broker",
    owner_user_id: auth.userId,
    owner_name: auth.fullName,
    owner_email: auth.email || null,
    branding: "white_label",
    active: true,
    created_by: auth.userId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token };
}

export type ChecklistItemInput = {
  documentTypeId: string;
  required: boolean;
  assignee: "borrower" | "lending_team";
  category: string; // the document "Type" used to group the checklist (free text)
  visibility: "all" | "lender_only"; // who sees it on the deal
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
      category: it.category.trim() || null,
      visibility: it.visibility === "lender_only" ? "lender_only" : "all",
      naming_override: it.namingOverride.trim() || null,
      review_rules_override: it.reviewRulesOverride.trim() || null,
      sort: i,
    }));
    const { error } = await supabase.from("program_checklist_items").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type StageTaskInput = {
  id?: string;
  stageBucket: string;
  label: string;
  visibility?: "all" | "lender_only";
  assignedTo?: "lender" | "borrower" | "broker" | null;
};

function normVisibility(v: string | undefined): "all" | "lender_only" {
  return v === "lender_only" ? "lender_only" : "all";
}
function normAssignedTo(v: string | null | undefined): string | null {
  return v === "lender" || v === "borrower" || v === "broker" ? v : null;
}

/**
 * Admin: replace a program's stage-task checklist. Existing tasks (sent with their id) are
 * updated in place so per-loan completion is preserved; new tasks are inserted; tasks the
 * admin removed are deleted (cascading their per-loan status). `sort` is assigned per bucket
 * in the order received. Relies on RLS for the admin check.
 */
export async function saveProgramStageTasks(
  programId: string,
  tasks: StageTaskInput[],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("program_stage_tasks")
    .select("id")
    .eq("program_id", programId);
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));

  const counters: Record<string, number> = {};
  const keep = new Set<string>();
  type TaskRow = { stage_bucket: string; label: string; sort: number; visibility: string; assigned_to: string | null };
  const updates: (TaskRow & { id: string })[] = [];
  const inserts: (TaskRow & { program_id: string })[] = [];

  for (const t of tasks) {
    const label = t.label.trim();
    if (!label) continue;
    const sort = counters[t.stageBucket] ?? 0;
    counters[t.stageBucket] = sort + 1;
    const common = {
      stage_bucket: t.stageBucket,
      label,
      sort,
      visibility: normVisibility(t.visibility),
      assigned_to: normAssignedTo(t.assignedTo),
    };
    if (t.id && existingIds.has(t.id)) {
      keep.add(t.id);
      updates.push({ id: t.id, ...common });
    } else {
      inserts.push({ program_id: programId, ...common });
    }
  }

  const toDelete = [...existingIds].filter((id) => !keep.has(id));
  if (toDelete.length) {
    const { error } = await supabase.from("program_stage_tasks").delete().in("id", toDelete);
    if (error) return { ok: false, error: error.message };
  }
  for (const u of updates) {
    const { error } = await supabase
      .from("program_stage_tasks")
      .update({
        stage_bucket: u.stage_bucket,
        label: u.label,
        sort: u.sort,
        visibility: u.visibility,
        assigned_to: u.assigned_to,
      })
      .eq("id", u.id);
    if (error) return { ok: false, error: error.message };
  }
  if (inserts.length) {
    const { error } = await supabase.from("program_stage_tasks").insert(inserts);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Admin: create or update a loan program. On create, `loanTypeKey` is required and is
 * normalized to a lowercase snake_case key (unique). On update, name/asset class/sort are
 * changed in place (the key is immutable — loans reference programs by id anyway). Relies
 * on RLS for the admin check (loan_programs has an is_admin() write policy).
 */
export async function saveProgram(input: {
  id?: string;
  name: string;
  assetClass: "residential" | "commercial";
  loanTypeKey?: string;
  sort?: number;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const supabase = await createClient();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  if (input.id) {
    const patch: Record<string, unknown> = { name, asset_class: input.assetClass };
    if (input.sort != null) patch.sort = input.sort;
    const { error } = await supabase.from("loan_programs").update(patch).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: input.id };
  }

  const key = (input.loanTypeKey ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return { ok: false, error: "A program key is required." };
  const { data, error } = await supabase
    .from("loan_programs")
    .insert({ name, loan_type_key: key, asset_class: input.assetClass, sort: input.sort ?? 0 })
    .select("id")
    .single();
  if (error) {
    return { ok: false, error: /duplicate|unique/i.test(error.message) ? `Program key "${key}" already exists.` : error.message };
  }
  return { ok: true, id: data.id as string };
}

export async function saveProgramPricing(input: {
  programId: string;
  mode: "model" | "guidelines" | "document";
  guidelines: string;
  model: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  // Merge the submitted grid fields into any existing model rather than replacing it, so a
  // program that also holds a parsed sizer (the DSCR engines live under model.engines) keeps it.
  const { data: existing } = await supabase
    .from("program_pricing")
    .select("model")
    .eq("program_id", input.programId)
    .maybeSingle();
  const merged = { ...((existing?.model as Record<string, unknown> | null) ?? {}), ...input.model };
  const { error } = await supabase.from("program_pricing").upsert(
    {
      program_id: input.programId,
      mode: input.mode,
      guidelines: input.guidelines.trim() || null,
      model: merged,
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
    // Internal status update: resolve against the full checklist (lender view).
    const checklist = await loadLoanChecklist(supabase, loanId, loan?.program_id ?? null, true);
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
