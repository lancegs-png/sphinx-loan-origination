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

/**
 * Find an existing deal folder under the configured parent whose name contains the
 * property `street` (e.g. "713 S Tipton St"). Lets the app reuse a folder created outside
 * the app (the "Open Loan Files" convention) instead of creating a duplicate. Returns the
 * single match's id, or null when there are zero or multiple matches (ambiguous — the
 * caller then creates a new one) or Drive isn't configured.
 */
export async function findDealFolderByStreet(street: string): Promise<string | null> {
  const parent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!parent || !street.trim()) return null;
  const token = await accessToken();
  const esc = street.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q =
    `'${parent}' in parents and mimeType='application/vnd.google-apps.folder'` +
    ` and trashed=false and name contains '${esc}'`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=10`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const json = (await res.json()) as { files?: { id: string; name: string }[] };
  const files = json.files ?? [];
  return files.length === 1 ? files[0].id : null;
}

/**
 * Find an existing DSCR dashboard spreadsheet already sitting in a deal folder, so the app
 * reuses it instead of creating a second copy (the cause of duplicate dashboards). Matches a
 * non-trashed Google Sheet whose name contains "Dashboard"; prefers the canonical
 * "DSCR Deal Dashboard - …" over the app's older "Loan Dashboard - …" name. Returns the
 * chosen sheet's id, or null when the folder has none (caller then creates one).
 */
export async function findDashboardInFolder(folderId: string): Promise<string | null> {
  if (!folderId) return null;
  const token = await accessToken();
  const q =
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet'` +
    ` and trashed=false and name contains 'Dashboard'`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=20`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const files = ((await res.json()) as { files?: { id: string; name: string }[] }).files ?? [];
  if (!files.length) return null;
  const canonical = files.find((f) => /dscr deal dashboard/i.test(f.name));
  return (canonical ?? files[0]).id;
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

// The master "DSCR Deal Dashboard - Template" in the Architecture folder. Each new deal
// folder gets its own copy, forced to a native Google Sheet so the Sheets API can write
// its cells. Overridable per environment.
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
      // Force a native Google Sheet copy (converts the template if it's an .xlsx) so the
      // Sheets API can write its cells.
      body: JSON.stringify({
        name,
        parents: [folderId],
        mimeType: "application/vnd.google-apps.spreadsheet",
      }),
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

/** Rename a Drive file (PATCH its name). */
export async function renameDriveFile(fileId: string, name: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw new Error(`Drive rename ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
