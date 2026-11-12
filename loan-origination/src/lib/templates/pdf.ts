import "server-only";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const execp = promisify(exec);
const execFileP = promisify(execFile);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Keep the logo/images sharp: lossless (PNG) compression, no resolution downsampling.
// (Local LibreOffice path only — the hosted converter applies its own defaults.)
const PDF_FILTER =
  "pdf:writer_pdf_Export:" +
  JSON.stringify({
    UseLosslessCompression: { type: "boolean", value: "true" },
    ReduceImageResolution: { type: "boolean", value: "false" },
    MaxImageResolution: { type: "long", value: "1200" },
  });

// LibreOffice headless is the faithful .docx -> PDF path (keeps the template's layout).
const CANDIDATES = [
  "soffice",
  "libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

let cached: string | null = null; // only a *found* binary is cached (so install needs no restart)

async function sofficeBin(): Promise<string | null> {
  if (cached) return cached;
  for (const c of CANDIDATES) {
    try {
      if (c.includes("/")) {
        await access(c, constants.X_OK);
        cached = c;
        return c;
      }
      await execp(`command -v ${c}`);
      cached = c;
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hosted converter (self-hosted Gotenberg — a maintained Docker image wrapping
// LibreOffice + Chromium). This is the production path: Vercel can't run
// LibreOffice, so the generated .docx is POSTed to the service and converted
// there. The .docx stays the single source of truth — the PDF is a faithful
// render of it, never a re-creation. See deploy/pdf-converter/README.md.
// ---------------------------------------------------------------------------

/** The configured converter base URL (no trailing slash), or null when unset. */
function converterBaseUrl(): string | null {
  const u = process.env.PDF_CONVERTER_URL?.trim();
  return u ? u.replace(/\/+$/, "") : null;
}

const CONVERT_TIMEOUT_MS = 60_000;

/**
 * Convert a document to PDF via the hosted Gotenberg service. `endpoint` is the
 * Gotenberg route (LibreOffice for Office docs, Chromium for HTML); the file is
 * sent as the multipart `files` field. An optional `PDF_CONVERTER_AUTH` env var
 * is forwarded verbatim as the Authorization header (e.g. "Basic <base64>").
 */
async function convertViaService(
  endpoint: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<Buffer> {
  const base = converterBaseUrl();
  if (!base) throw new Error("PDF_CONVERTER_URL is not set.");

  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

  const headers: Record<string, string> = {};
  const auth = process.env.PDF_CONVERTER_AUTH?.trim();
  if (auth) headers.Authorization = auth;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONVERT_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      body: form,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `PDF converter returned ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("PDF converter timed out.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const NOT_CONFIGURED_MSG =
  "PDF export isn't configured on this server. Set PDF_CONVERTER_URL to a Gotenberg " +
  "converter (see deploy/pdf-converter/README.md), or install LibreOffice locally " +
  "(`brew install --cask libreoffice`) for development.";

/** True when PDF export can run: a hosted converter is configured, or a local binary exists. */
export async function pdfConversionAvailable(): Promise<boolean> {
  if (converterBaseUrl()) return true;
  return (await sofficeBin()) !== null;
}

/** Convert a filled .docx to PDF — hosted converter in production, local LibreOffice in dev. */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  if (converterBaseUrl()) {
    return convertViaService("/forms/libreoffice/convert", docx, "document.docx", DOCX_MIME);
  }

  const bin = await sofficeBin();
  if (!bin) throw new Error(NOT_CONFIGURED_MSG);
  const dir = await mkdtemp(path.join(tmpdir(), "tmpl-"));
  const inPath = path.join(dir, "doc.docx");
  await writeFile(inPath, docx);
  try {
    // execFile (no shell) so the JSON filter arg needs no escaping.
    await execFileP(bin, ["--headless", "--convert-to", PDF_FILTER, "--outdir", dir, inPath], {
      timeout: 60_000,
    });
    return await readFile(path.join(dir, "doc.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Convert an HTML string to PDF (e.g. the activity log) — hosted converter in production, local LibreOffice in dev. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  if (converterBaseUrl()) {
    // Gotenberg's Chromium route renders HTML faithfully; it requires the main file to be index.html.
    return convertViaService(
      "/forms/chromium/convert/html",
      Buffer.from(html, "utf8"),
      "index.html",
      "text/html",
    );
  }

  const bin = await sofficeBin();
  if (!bin) throw new Error(NOT_CONFIGURED_MSG);
  const dir = await mkdtemp(path.join(tmpdir(), "log-"));
  const inPath = path.join(dir, "log.html");
  await writeFile(inPath, html, "utf8");
  try {
    await execFileP(bin, ["--headless", "--convert-to", "pdf:writer_pdf_Export", "--outdir", dir, inPath], {
      timeout: 60_000,
    });
    return await readFile(path.join(dir, "log.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
