import { secretOk } from "@/lib/admin-auth";
import { emailFrom, verifyTransport } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops-only health check for transactional email: authenticates to the SMTP server WITHOUT sending
 * anything (nodemailer `verify`), and reports which SMTP_* vars are present (never their values).
 * No service role needed; gated by SHEETS_SYNC_SECRET like the other /api/admin/* routes.
 *   { secret } -> { ok, configured, present: {...}, from, error? }
 * Status: 200 verified, 502 configured but auth failed, 503 SMTP not configured.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (!secretOk(String(body.secret ?? ""))) return new Response("Unauthorized", { status: 401 });

  // Presence only — never echo secret values back.
  const present = {
    SMTP_HOST: Boolean(process.env.SMTP_HOST),
    SMTP_PORT: process.env.SMTP_PORT ?? "587 (default)",
    SMTP_USER: Boolean(process.env.SMTP_USER),
    SMTP_PASS: Boolean(process.env.SMTP_PASS),
    SMTP_FROM: Boolean(process.env.SMTP_FROM),
  };

  const result = await verifyTransport();
  const status = result.ok ? 200 : result.configured ? 502 : 503;
  return Response.json({ ...result, present, from: emailFrom() }, { status });
}
