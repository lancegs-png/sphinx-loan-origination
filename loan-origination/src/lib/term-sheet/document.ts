import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";

/** Everything the LOI / term sheet needs, gathered from the loan record. */
export type TermSheetData = {
  date: string;
  greetingName: string; // "Hi {name},"
  // Preliminary Transaction Details
  loanAmount: number;
  fico: number | null;
  interestRate: string; // "7.25%"
  propertyValue: number | null;
  loanProgram: string;
  ltv: string; // "75.19%"
  propertyType: string;
  prepay: string; // label
  loanTermMonths: number;
  dscr: string;
  loanPurpose: string;
  loanType: string;
  entity: string;
  guarantor: string;
  monthlyPI: number | null;
  // Fees
  originationPct: string; // "1.00"
  propertyAddress: string; // Exhibit A
  // Lender (company config)
  lenderName: string;
  lenderSigner: string;
  lenderSignerTitle: string;
  // Signature (present once signed)
  signature?: { name: string; dateStr: string } | null;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

// ---- Block model -----------------------------------------------------------

type Block =
  | { type: "brand" }
  | { type: "title"; text: string }
  | { type: "h2"; text: string }
  | { type: "meta"; text: string }
  | { type: "p"; text: string }
  | { type: "small"; text: string }
  | { type: "kv"; rows: [string, string][] }
  | { type: "checklist"; rows: [string, string][] }
  | { type: "acceptance" }
  | { type: "gap"; h: number }
  | { type: "pagebreak" };

function buildBlocks(d: TermSheetData): Block[] {
  const pi = d.monthlyPI;
  return [
    { type: "brand" },
    { type: "meta", text: d.date },
    { type: "meta", text: "Re:  Property Address – See Exhibit A" },
    { type: "gap", h: 8 },
    { type: "p", text: `Hi ${d.greetingName},` },
    {
      type: "p",
      text:
        'Thank you for providing Sphinx Capital, LLC (“Originator”) information regarding your ' +
        "request for business purpose real estate financing. Based on our preliminary and limited " +
        "review of the information provided, we are pleased to inform you of our interest in pursuing " +
        "this opportunity further, subject to the terms and conditions set forth below. If the below " +
        "terms are acceptable, please sign this preliminary approval letter to begin the process as " +
        "detailed in Exhibit B.",
    },
    { type: "h2", text: "Preliminary Transaction Details" },
    {
      type: "kv",
      rows: [
        ["Loan Amount", money(d.loanAmount)],
        ["Stated Borrower/Sponsor FICO", d.fico != null ? String(d.fico) : "—"],
        ["Interest Rate*", d.interestRate],
        ["Estimated Property Value", money(d.propertyValue)],
        ["Loan Program", d.loanProgram],
        ["Loan-to-Value Ratio (LTV)", d.ltv],
        ["Property Type", d.propertyType],
        ["Prepayment Penalty", d.prepay],
        ["Loan Term", `${d.loanTermMonths} Months`],
        ["Estimated Net Cash Flow DSCR", d.dscr],
        ["Loan Purpose", d.loanPurpose],
        ["Escrow Account", "Yes (Taxes and Insurance)"],
        ["Loan Type", d.loanType],
        ["Amortization Term", `${d.loanTermMonths} Months`],
        ["Borrowing Entity", d.entity],
        ["Payment Escrow", "Minimum 2 Months PITI"],
        ["Personal Guaranty", d.guarantor],
        ["Estimated Monthly P+I", money(pi)],
      ],
    },
    {
      type: "small",
      text:
        "*The Interest Rate will be locked following the execution date of this Letter of Intent, and " +
        "the rate lock will be for 30 calendar days. Your Loan Interest Rate is based on loan credit " +
        "parameters, represented by you (and stated in this Letter), and may be changed if differences " +
        "are found in underwriting, at the Originator’s sole discretion.",
    },
    { type: "h2", text: "Estimated Fees & Other Details*" },
    {
      type: "kv",
      rows: [
        ["Rate Buydown", "0% of the Loan Amount"],
        ["Origination Fee", `${d.originationPct}% of the Loan Amount (includes brokers)`],
        ["Processing Fee", "$500"],
        ["Legal/Doc Fee", "$250"],
        [
          "Appraisals",
          "Costs can vary based on several factors including geographic region, the service " +
            "provider and the type of report ordered. Costs are controlled by independent third " +
            "parties, subject to change without notice and are not within the Originator’s control. " +
            "Appraisals are paid for by the Borrower.",
        ],
      ],
    },
    {
      type: "small",
      text:
        "* The above estimates do not include title fees, borrower’s legal fees, or any other " +
        "third-party costs incurred while closing the loan.",
    },
    {
      type: "p",
      text:
        "We appreciate the opportunity to present this proposal and look forward to the possibility " +
        "of working with you. To accept this proposal and proceed with the process, please sign the " +
        "acknowledgment on the following page.",
    },
    { type: "gap", h: 6 },
    { type: "p", text: "Sincerely," },
    { type: "p", text: d.lenderSigner || "—" },
    { type: "p", text: d.lenderSignerTitle || "" },
    { type: "pagebreak" },
    { type: "h2", text: "Disclaimer" },
    {
      type: "p",
      text:
        "The proposed Loan Interest Rate and terms may be unilaterally withdrawn or adjusted by " +
        "Originator in its sole discretion at any time in the event, during the underwriting process, " +
        "certain loan parameters are determined to be materially and adversely different compared to " +
        "those presented at the time this Letter was issued.",
    },
    {
      type: "p",
      text:
        "Please note this Preliminary Approval Letter serves to outline the terms of the proposed " +
        "financing of the referenced transaction. This Preliminary Approval Letter is merely a general " +
        "proposal and is neither a binding offer nor a contract. Borrower understands and agrees that " +
        "Originator is not obligated to enter into the transaction contemplated by this Preliminary " +
        "Approval Letter, on the terms set forth herein, or on any other terms, unless and until " +
        "Originator obtains internal committee approval, and Originator or its capital partner executes " +
        "and delivers to Borrower final definitive loan documents, the terms of which shall supersede in " +
        "their entirety the terms set forth herein. No party shall have any legal rights or obligations " +
        "with respect to the other unless and until a formal application for the potential loan is signed " +
        "by both Originator and Borrower.",
    },
    { type: "h2", text: "Borrower Acceptance" },
    { type: "acceptance" },
    { type: "pagebreak" },
    { type: "h2", text: "Exhibit A – Property Address" },
    { type: "p", text: d.propertyAddress || "—" },
    { type: "h2", text: "Exhibit B – DSCR Loan Underwriting Checklist" },
    {
      type: "p",
      text:
        "Below are the documents that are required to be reviewed in underwriting, along with " +
        "explanations of why we collect each specific document. You will receive an online version " +
        "of this checklist during the process as well.",
    },
    {
      type: "checklist",
      rows: [
        ["Loan Application", "This will be sent to you to complete online."],
        ["Copy of ID", "Copy or picture of driver license or passport for all borrowers."],
        [
          "Entity Formation Document",
          "Typically called the Articles of Incorporation or Certificate of Formation.",
        ],
        [
          "Entity Operating Agreement or Bylaws",
          "LLCs use Operating Agreements, Corporations use Bylaws. Must be signed by all entity " +
            "members and include the % of ownership for each.",
        ],
        [
          "Entity EIN Letter or W9 Form",
          "If you don’t have a copy of the original EIN Letter, we’ll send you the W9.",
        ],
        [
          "Schedule of Real Estate Owned",
          "Used to verify past property ownership experience. Must include the address, owner on " +
            "title, estimated value, and date acquired.",
        ],
        ["Lease Agreements", "Make sure to include all pages and signatures."],
        [
          "Proof of Rent Received / Rental Ledgers",
          "Verifies that tenants are making their payments on time.",
        ],
        ["Voided Check", "Verifies the account that you will make loan payments from."],
        [
          "Two Months’ Bank Statements",
          "Verifies available liquidity; we require 6 months of payment reserves.",
        ],
        ["Original Settlement Statement (refinance only)", "Verifies ownership and acquisition price."],
        ["Purchase Contract (purchase only)", "Ensure the contract is signed and all addendums included."],
      ],
    },
  ];
}

// ---- Renderer --------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 64;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.38, 0.38, 0.4);
const RULE = rgb(0.82, 0.82, 0.84);

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderTermSheetPdf(d: TermSheetData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Sphinx Capital — Letter of Intent");

  const body = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Sphinx-branded documents get the logo; white-label keeps the lender name.
  const isSphinx = !d.lenderName || /sphinx/i.test(d.lenderName);
  let logo: PDFImage | null = null;
  if (isSphinx) {
    try {
      const bytes = await readFile(path.join(process.cwd(), "public", "brand", "sphinx-logo.png"));
      logo = await doc.embedPng(bytes);
    } catch {
      logo = null; // fall back to the text header if the asset can't be read
    }
  }

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const need = (h: number) => {
    if (y - h < MARGIN) newPage();
  };
  const line = (
    text: string,
    font: PDFFont,
    size: number,
    gap: number,
    color: RGB = INK,
    x = MARGIN,
  ) => {
    need(size + gap);
    y -= size;
    page.drawText(text, { x, y, size, font, color });
    y -= gap;
  };
  const paragraph = (
    text: string,
    font: PDFFont,
    size: number,
    lead: number,
    color: RGB = INK,
    x = MARGIN,
    maxW = CONTENT_W,
  ) => {
    for (const ln of wrap(text, font, size, maxW)) line(ln, font, size, lead - size, color, x);
  };

  for (const b of buildBlocks(d)) {
    switch (b.type) {
      case "brand": {
        if (logo) {
          const w = 150;
          const h = (logo.height / logo.width) * w;
          need(h + 4);
          y -= h;
          page.drawImage(logo, { x: MARGIN, y, width: w, height: h });
          y -= 4;
        } else {
          line((d.lenderName || "Sphinx Capital, LLC").toUpperCase(), sansBold, 15, 3, INK);
        }
        line("Business Purpose Real Estate Financing", sans, 9, 6, MUTED);
        need(10);
        page.drawLine({
          start: { x: MARGIN, y: y + 2 },
          end: { x: PAGE_W - MARGIN, y: y + 2 },
          thickness: 1,
          color: RULE,
        });
        y -= 12;
        break;
      }
      case "title":
        line(b.text, bold, 14, 8);
        break;
      case "h2":
        y -= 6;
        line(b.text, sansBold, 11, 6, INK);
        break;
      case "meta":
        line(b.text, body, 10.5, 2, INK);
        break;
      case "p":
        paragraph(b.text, body, 10.5, 14);
        y -= 5;
        break;
      case "small":
        paragraph(b.text, italic, 8.5, 11, MUTED);
        y -= 4;
        break;
      case "gap":
        y -= b.h;
        break;
      case "pagebreak":
        newPage();
        break;
      case "kv": {
        const labelW = 190;
        const valX = MARGIN + labelW + 14;
        const valW = PAGE_W - MARGIN - valX;
        for (const [label, value] of b.rows) {
          const labelLines = wrap(label, bold, 10, labelW);
          const valueLines = wrap(value, body, 10, valW);
          const rows = Math.max(labelLines.length, valueLines.length);
          const rowH = rows * 13 + 7;
          need(rowH);
          const top = y;
          labelLines.forEach((ln, i) =>
            page.drawText(ln, { x: MARGIN, y: top - 10 - i * 13, size: 10, font: bold, color: INK }),
          );
          valueLines.forEach((ln, i) =>
            page.drawText(ln, { x: valX, y: top - 10 - i * 13, size: 10, font: body, color: INK }),
          );
          y = top - rowH;
          page.drawLine({
            start: { x: MARGIN, y: y + 3 },
            end: { x: PAGE_W - MARGIN, y: y + 3 },
            thickness: 0.5,
            color: RULE,
          });
        }
        y -= 6;
        break;
      }
      case "checklist": {
        const colW = (CONTENT_W - 14) / 2;
        const c2X = MARGIN + colW + 14;
        need(20);
        page.drawText("Document", { x: MARGIN, y: y - 10, size: 9.5, font: sansBold, color: INK });
        page.drawText("Purpose / Tips", { x: c2X, y: y - 10, size: 9.5, font: sansBold, color: INK });
        y -= 18;
        page.drawLine({
          start: { x: MARGIN, y: y + 3 },
          end: { x: PAGE_W - MARGIN, y: y + 3 },
          thickness: 0.6,
          color: RULE,
        });
        for (const [name, purpose] of b.rows) {
          const nameLines = wrap(name, bold, 9.5, colW);
          const purposeLines = wrap(purpose, body, 9.5, colW);
          const rows = Math.max(nameLines.length, purposeLines.length);
          const rowH = rows * 12 + 7;
          need(rowH);
          const top = y;
          nameLines.forEach((ln, i) =>
            page.drawText(ln, { x: MARGIN, y: top - 10 - i * 12, size: 9.5, font: bold, color: INK }),
          );
          purposeLines.forEach((ln, i) =>
            page.drawText(ln, { x: c2X, y: top - 10 - i * 12, size: 9.5, font: body, color: INK }),
          );
          y = top - rowH;
          page.drawLine({
            start: { x: MARGIN, y: y + 3 },
            end: { x: PAGE_W - MARGIN, y: y + 3 },
            thickness: 0.4,
            color: RULE,
          });
        }
        y -= 6;
        break;
      }
      case "acceptance": {
        const sig = d.signature;
        const fieldLine = (label: string, value: string, scriptVal = false) => {
          need(34);
          const lineY = y - 20;
          page.drawText(label, { x: MARGIN, y: lineY + 3, size: 10, font: bold, color: INK });
          page.drawLine({
            start: { x: MARGIN + 80, y: lineY },
            end: { x: MARGIN + 320, y: lineY },
            thickness: 0.8,
            color: INK,
          });
          if (value) {
            page.drawText(value, {
              x: MARGIN + 88,
              y: lineY + 4,
              size: scriptVal ? 15 : 10.5,
              font: scriptVal ? italic : body,
              color: scriptVal ? rgb(0.05, 0.1, 0.45) : INK,
            });
          }
          y = lineY - 14;
        };
        fieldLine("Name:", sig?.name ?? "");
        fieldLine("Signature:", sig?.name ?? "", true);
        fieldLine("Date:", sig?.dateStr ?? "");
        if (sig) {
          y -= 2;
          line(
            "Electronically signed. An authentication record (signer, timestamp, IP) is retained with the loan file.",
            italic,
            8,
            6,
            MUTED,
          );
        }
        y -= 4;
        break;
      }
    }
  }

  return doc.save();
}
