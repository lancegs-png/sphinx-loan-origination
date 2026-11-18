import "server-only";
import { readSheets, at, toNum, toStr, toDateISO, type CellMap } from "./xlsx-read";
import type { GeneralConfig, LtvGrid, LevRow, Purpose } from "./general";

// Eastview "EV DSCR S Sizer" → GeneralConfig. Pricing lives in the "Pricing" tab (base curves +
// stacked LLPA grids) and "Lev Grid" (max LTV by FICO × purpose). Sheet values are 1.0-based
// (0.98 = 98 points), so prices and adjustments are scaled ×100 to the engine's 100-based points.

const LTV_COLS = [9, 10, 11, 12, 13, 14, 15]; // I..O, aligned to LTV_UPPERS [50,55,60,65,70,75,80]

function readGrid(P: CellMap, r0: number, r1: number): LtvGrid {
  const grid: LtvGrid = {};
  for (let r = r0; r <= r1; r++) {
    const label = toStr(at(P, r, 8)); // col H
    if (!label) continue;
    grid[label] = LTV_COLS.map((c) => {
      const n = toNum(at(P, r, c));
      return n == null ? null : n * 100; // → points
    });
  }
  return grid;
}

function purposeOf(s: string): Purpose | null {
  const l = s.toLowerCase();
  if (l.includes("cash out")) return "co";
  if (l.includes("refinance")) return "rt";
  if (l.includes("purchase")) return "purchase";
  return null;
}

export async function parseEastview(buffer: Buffer, sourceFile: string | null): Promise<GeneralConfig> {
  const sheets = await readSheets(buffer, ["Pricing", "Lev Grid"]);
  const P = sheets["Pricing"];
  const L = sheets["Lev Grid"];
  if (!P) throw new Error("Eastview: 'Pricing' tab not found — is this the EV DSCR sizer?");

  // Base curves: Coupon col C(3); prices 5/1 D(4), 7/1 E(5), Fixed 30 F(6); rows 9..33.
  const curve = (priceCol: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 9; r <= 33; r++) {
      const coupon = toNum(at(P, r, 3));
      const price = toNum(at(P, r, priceCol));
      if (coupon != null && price != null) out.push([coupon, price * 100]);
    }
    return out;
  };

  // Notes: label col B(2), value col E(5).
  const notes: Record<string, number | null> = {};
  for (let r = 36; r <= 50; r++) {
    const lab = toStr(at(P, r, 2));
    if (lab) notes[lab] = toNum(at(P, r, 5));
  }
  const minPrice = notes["Min Price"] != null ? notes["Min Price"]! * 100 : 96.75;
  const minLoan = notes["Min Loan Amount"] ?? 100000;
  const maxLoan = notes["Max Loan Amount"] ?? 3000000;

  // Max-price caps (Prepayment Premiums): labels col B(2), value col E(5), rows 71..76.
  const caps: Record<string, number | null> = {};
  for (let r = 71; r <= 76; r++) {
    const lab = toStr(at(P, r, 2));
    const v = toNum(at(P, r, 5));
    if (lab && v != null) caps[lab] = v * 100;
  }

  // Leverage grid: FICO label B(2), purpose C(3), max as-is LTV E(5), max LTC F(6), rows 5..28.
  const levRows: LevRow[] = [];
  if (L) {
    for (let r = 5; r <= 28; r++) {
      const ficoRaw = toStr(at(L, r, 2));
      const purpose = purposeOf(toStr(at(L, r, 3)));
      if (!ficoRaw || !purpose) continue;
      levRows.push({
        fico: ficoRaw.replace(/^FICO:\s*/i, "").trim(),
        purpose,
        max_asis_ltv: toNum(at(L, r, 5)),
        max_ltc: toNum(at(L, r, 6)),
      });
    }
  }

  const effective = toDateISO(at(P, 6, 2));
  const tierScan = [16, 17, 15, 18].map((c) => toStr(at(P, 6, c))).find((s) => s && !/\d/.test(s));

  return {
    family: "eastview",
    investor: "Eastview",
    effective_date: effective,
    tier: tierScan ?? null,
    source_file: sourceFile,
    base_curves: { fixed30: curve(6), arm_5_1: curve(4), arm_7_1: curve(5) },
    grids: {
      fico: readGrid(P, 11, 20),
      dscr: readGrid(P, 24, 26),
      upb: readGrid(P, 30, 31),
      purpose: readGrid(P, 35, 36),
      proptype: readGrid(P, 40, 43),
      prepay: readGrid(P, 47, 52),
      other: readGrid(P, 56, 57),
    },
    caps,
    min_price: minPrice,
    lock: { d45: null, d60: null },
    leverage: { rows: levRows, min_loan: minLoan, max_loan: maxLoan },
    min_loan: minLoan,
    max_loan: maxLoan,
  };
}
