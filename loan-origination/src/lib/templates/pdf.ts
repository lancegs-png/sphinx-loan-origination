import "server-only";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const execp = promisify(exec);

// LibreOffice headless is the faithful .docx -> PDF path (keeps the template's layout).
const CANDIDATES = [
  "soffice",
  "libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

let cached: string | null | undefined;

async function sofficeBin(): Promise<string | null> {
  if (cached !== undefined) return cached;
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
  cached = null;
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
    await execp(
      `"${bin}" --headless --convert-to pdf --outdir "${dir}" "${inPath}"`,
      { timeout: 60_000 },
    );
    return await readFile(path.join(dir, "doc.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
