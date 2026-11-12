import "server-only";
import { GoogleAuth } from "google-auth-library";

// Render a Google Doc template to PDF or .docx entirely inside the user's own Google
// Workspace (no LibreOffice): copy the template, replace every {{key}}, export the copy,
// then trash it. The template Doc must be shared with the service account as an Editor.
// Mirrors the auth approach in ./sheets.ts / ./drive.ts. The broad `drive` scope also
// authorizes the Docs API batchUpdate; `documents` is included belt-and-suspenders.
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
];

function serviceAccount(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Whether Google-Doc template rendering is available (service account configured). */
export function docTemplatesConfigured(): boolean {
  return serviceAccount() !== null;
}

async function accessToken(): Promise<string> {
  const creds = serviceAccount();
  if (!creds) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const auth = new GoogleAuth({ credentials: creds as never, scopes: SCOPES });
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  if (!t.token) throw new Error("Could not obtain a Google access token.");
  return t.token;
}

export type DocExportFormat = "pdf" | "docx";

const EXPORT_MIME: Record<DocExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function driveParent(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const parents = ((await res.json()) as { parents?: string[] }).parents;
  return parents?.[0] ?? null;
}

/**
 * Render a Google Doc template to `format` by copying it, replacing every {{key}} in
 * `data` with its value (blanks stay blank), exporting the copy, then trashing it. The
 * copy is made in the template's own folder (so it stays in the same drive) and always
 * removed, even on failure.
 */
export async function renderDocTemplate(
  templateDocId: string,
  data: Record<string, string>,
  format: DocExportFormat,
): Promise<Buffer> {
  const token = await accessToken();
  const parent = await driveParent(token, templateDocId);

  // 1. Copy the template to a throwaway Doc (kept in the same folder/drive).
  const copyRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${templateDocId}/copy?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `__render_${Date.now()}`, parents: parent ? [parent] : undefined }),
    },
  );
  if (!copyRes.ok) throw new Error(`Doc copy ${copyRes.status}: ${(await copyRes.text()).slice(0, 200)}`);
  const copyId = ((await copyRes.json()) as { id: string }).id;

  try {
    // 2. Replace every {{key}} with its value (matchCase: the tags are lowercase keys).
    // Newlines in a value (e.g. a multi-property Exhibit A list) become Docs line breaks
    // (U+000B / Shift+Enter) rather than "\n": replaceAllText would otherwise start a new
    // paragraph per line, which re-triggers any list numbering on the host paragraph.
    const requests = Object.entries(data).map(([key, value]) => ({
      replaceAllText: {
        containsText: { text: `{{${key}}}`, matchCase: true },
        replaceText: (value ?? "").replace(/\r?\n/g, "\u000B"),
      },
    }));
    if (requests.length) {
      const upRes = await fetch(`https://docs.googleapis.com/v1/documents/${copyId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });
      if (!upRes.ok) throw new Error(`Doc batchUpdate ${upRes.status}: ${(await upRes.text()).slice(0, 200)}`);
    }

    // 3. Export the filled copy to PDF / .docx.
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${copyId}/export?mimeType=${encodeURIComponent(
        EXPORT_MIME[format],
      )}&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!exportRes.ok)
      throw new Error(`Doc export ${exportRes.status}: ${(await exportRes.text()).slice(0, 200)}`);
    return Buffer.from(await exportRes.arrayBuffer());
  } finally {
    // 4. Trash the throwaway copy (best-effort — never fail the render on cleanup).
    await fetch(`https://www.googleapis.com/drive/v3/files/${copyId}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    }).catch(() => {});
  }
}
