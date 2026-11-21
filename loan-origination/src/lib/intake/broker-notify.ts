import "server-only";
import { INTAKE_FORM_SPEC } from "./form-spec";
import { sendMail } from "@/lib/email";

/**
 * Email a broker/referral partner when a client submits their shareable intake link, with a copy of
 * the responses. Rendered from INTAKE_FORM_SPEC so fields appear grouped and labeled in form order.
 * Best-effort: never throws (SMTP failures are swallowed by sendMail), so it can't break the submit.
 */

// The broker's own attribution fields and transport/bookkeeping keys — not part of the client's answers.
const SKIP_KEYS = new Set([
  "broker_name", "broker_email", "broker_phone", "source_channel", "website", "token",
]);

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

type Group = { title: string; rows: Array<{ label: string; value: string }> };

function groupResponses(values: Record<string, string>): Group[] {
  const groups: Group[] = [];
  for (const section of INTAKE_FORM_SPEC) {
    const rows: Array<{ label: string; value: string }> = [];
    for (const f of section.fields) {
      if (SKIP_KEYS.has(f.key)) continue;
      const v = (values[f.key] ?? "").trim();
      if (v) rows.push({ label: f.label, value: v });
    }
    if (rows.length) groups.push({ title: section.title, rows });
  }
  return groups;
}

export async function notifyBrokerOfSubmission(input: {
  ownerName: string | null;
  ownerEmail: string;
  loanRef: string;
  loanUrl: string | null;
  values: Record<string, string>;
}): Promise<void> {
  const { ownerName, ownerEmail, loanRef, loanUrl, values } = input;
  const borrower =
    [values.guarantor_first_name, values.guarantor_last_name].filter(Boolean).join(" ").trim() ||
    (values.borrower_entity ?? "").trim() ||
    "A client";
  const address = [
    values.property_street,
    [values.property_city, [values.property_state, values.property_zip].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join(", ");
  const borrowerEmail = (values.borrower_email ?? "").trim();
  const groups = groupResponses(values);

  const subject = `New application from ${borrower}${address ? ` — ${address}` : ""} (${loanRef})`;

  const textLines: string[] = [
    `${borrower} just submitted an application through your Sphinx Capital intake link.`,
    "",
    `Opportunity: ${loanRef}`,
    address ? `Property: ${address}` : "",
    loanUrl ? `View it: ${loanUrl}` : "",
    "",
    "Responses",
    "=========",
  ].filter((l) => l !== "");
  for (const g of groups) {
    textLines.push("", g.title);
    for (const r of g.rows) textLines.push(`  ${r.label}: ${r.value}`);
  }
  const text = textLines.join("\n");

  const groupsHtml = groups
    .map(
      (g) =>
        `<h3 style="margin:18px 0 6px;font:600 14px system-ui,sans-serif;color:#111">${esc(g.title)}</h3>` +
        `<table style="border-collapse:collapse;width:100%;font:14px system-ui,sans-serif">` +
        g.rows
          .map(
            (r) =>
              `<tr><td style="padding:3px 12px 3px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(
                r.label,
              )}</td><td style="padding:3px 0;color:#111">${esc(r.value)}</td></tr>`,
          )
          .join("") +
        `</table>`,
    )
    .join("");

  const html = `<div style="max-width:640px;margin:0 auto;font:14px system-ui,sans-serif;color:#111">
  <p>Hi${ownerName ? ` ${esc(ownerName.split(" ")[0])}` : ""}, <strong>${esc(
    borrower,
  )}</strong> just submitted an application through your Sphinx Capital intake link.</p>
  <p style="margin:6px 0"><strong>Opportunity:</strong> ${esc(loanRef)}${
    address ? `<br><strong>Property:</strong> ${esc(address)}` : ""
  }</p>
  ${loanUrl ? `<p><a href="${esc(loanUrl)}" style="color:#1a56db">View this deal in your pipeline →</a></p>` : ""}
  ${groupsHtml}
  <p style="margin-top:22px;color:#888;font-size:12px">You're receiving this because the application came in on your shareable intake link.</p>
</div>`;

  await sendMail({
    to: ownerEmail,
    subject,
    html,
    text,
    replyTo: borrowerEmail || undefined,
  });
}
