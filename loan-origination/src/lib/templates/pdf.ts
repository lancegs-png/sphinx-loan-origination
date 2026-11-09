import "server-only";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const execp = promisify(exec);
const execFileP = promisify(execFile);

// Keep the logo/images sharp: lossless (PNG) compression, no resolution downsampling.
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

export async function pdfConversionAvailable(): Promise<boolean> {
  return (await sofficeBin()) !== null;
}

/** Convert a filled .docx to PDF via LibreOffice headless. */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const bin = await sofficeBin();
  if (!bin) {
    throw new Error(
      "PDF export needs LibreOffice. Install it (e.g. `brew install --cask libreoffice`) and retry.",
    );
  }
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

/** Convert an HTML string to PDF via LibreOffice headless (e.g. the activity log). */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const bin = await sofficeBin();
  if (!bin) {
    throw new Error(
      "PDF export needs LibreOffice. Install it (e.g. `brew install --cask libreoffice`) and retry.",
    );
  }
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
