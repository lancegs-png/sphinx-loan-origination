import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Minimal transactional-email sender over SMTP (reuses the processing@sphinxcap.com mailbox that
 * also backs Supabase Auth). Configured entirely from env; if the SMTP vars are absent the sender
 * is a no-op that reports `skipped` rather than throwing, so callers stay best-effort and a missing
 * config never breaks the request that triggered the email.
 *
 * Env: SMTP_HOST, SMTP_USER, SMTP_PASS (required), SMTP_PORT (default 587; 465 => implicit TLS),
 * SMTP_FROM (default: SMTP_USER).
 */

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

let transporter: Transporter | null = null;
let configured: boolean | null = null;

function getTransport(): Transporter | null {
  if (configured === false) return null;
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    configured = false;
    return null;
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  configured = true;
  return transporter;
}

export function emailFrom(): string {
  return process.env.SMTP_FROM || process.env.SMTP_USER || "processing@sphinxcap.com";
}

/**
 * Authenticate to the SMTP server WITHOUT sending anything (nodemailer `verify`). Lets an ops
 * health check confirm the SMTP_* env is present and the credentials work in a given environment.
 * Returns `configured: false` when the vars are absent (the sender is a no-op in that state).
 */
export async function verifyTransport(): Promise<{ ok: boolean; configured: boolean; error?: string }> {
  const t = getTransport();
  if (!t) return { ok: false, configured: false };
  try {
    await t.verify();
    return { ok: true, configured: true };
  } catch (e) {
    return { ok: false, configured: true, error: e instanceof Error ? e.message : "verify failed" };
  }
}

export async function sendMail(input: MailInput): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const t = getTransport();
  if (!t) return { ok: false, skipped: true };
  try {
    await t.sendMail({
      from: emailFrom(),
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
