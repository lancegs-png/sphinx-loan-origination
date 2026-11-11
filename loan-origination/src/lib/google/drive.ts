import "server-only";
import { GoogleAuth } from "google-auth-library";

// Real Google Drive helpers for mirroring loan documents into a deal's folder.
// Mirrors the auth approach in ./sheets.ts. All calls are no-ops unless the service
// account AND a parent folder are configured (see `driveConfigured`).

const SCOPES = ["https://www.googleapis.com/auth/drive"];

function serviceAccount(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Drive mirroring is available only when the service account is set AND a parent
 * folder id is configured (new per-deal folders are created inside it). The parent
 * folder must be shared with the service account's email as an Editor.
 */
export function driveConfigured(): boolean {
  return serviceAccount() !== null && !!process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
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

/** Create a Drive folder for a deal under the configured parent; returns its id. */
export async function createDealFolder(name: string): Promise<string> {
  const parent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  const token = await accessToken();
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parent ? [parent] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Drive folder create ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

// The master DSCR Deal Dashboard (a native Google Sheet in the Architecture folder).
// Each new deal folder gets its own copy. Overridable per environment.
const DSCR_DASHBOARD_TEMPLATE_ID =
  process.env.GOOGLE_DSCR_DASHBOARD_TEMPLATE_ID || "1u20xar0tDxSsKt6C2PHfhQFUQqEiox4RATrNETrzTz4";

/**
 * Copy the DSCR dashboard template into a deal folder under `name`
 * ("Loan Dashboard - <street> - <loan #>"). Returns the new sheet's id. Best-effort:
 * the caller shouldn't fail the upload if this throws.
 */
export async function createDealDashboard(folderId: string, name: string): Promise<string> {
  const token = await accessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${DSCR_DASHBOARD_TEMPLATE_ID}/copy?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, parents: [folderId] }),
    },
  );
  if (!res.ok) throw new Error(`Dashboard copy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** Upload a file into a Drive folder; returns its id and shareable web link. */
export async function uploadFileToDrive(args: {
  folderId: string;
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<{ id: string; webViewLink: string | null }> {
  const token = await accessToken();
  const boundary = "sphinx" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: args.fileName, parents: [args.folderId] });
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${meta}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${args.contentType || "application/octet-stream"}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, args.bytes as BlobPart, tail]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return { id: json.id, webViewLink: json.webViewLink ?? null };
}

/**
 * Best-effort removal of a Drive file: move it to the trash (PATCH trashed=true)
 * rather than hard-delete. On a Shared Drive the service account is a Content Manager,
 * which cannot permanently delete (DELETE returns 404), but it can trash. Trashing is
 * also recoverable, and the file stops showing in the deal folder.
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  );
  if (!res.ok) throw new Error(`Drive trash ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
