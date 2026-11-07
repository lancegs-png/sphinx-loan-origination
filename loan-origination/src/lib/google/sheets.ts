import "server-only";
import { GoogleAuth } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
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

/** Whether the Google service account is configured (env set + parseable). */
export function sheetsConfigured(): boolean {
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

async function api(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Create a spreadsheet (optionally inside a Drive folder); returns its id. */
export async function createLoanSheet(title: string, driveFolderId?: string | null): Promise<string> {
  const created = await api("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify({ properties: { title } }),
  });
  const id = created.spreadsheetId as string;
  if (driveFolderId) {
    await api(
      `https://www.googleapis.com/drive/v3/files/${id}?addParents=${driveFolderId}&fields=id,parents`,
      { method: "PATCH", body: "{}" },
    );
  }
  return id;
}

/** Overwrite a sheet's values with `rows` (anchored at A1). */
export async function writeSheetValues(sheetId: string, rows: (string | number)[][]): Promise<void> {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z20000:clear`, {
    method: "POST",
    body: "{}",
  });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: rows }),
  });
}

export function sheetUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}`;
}
