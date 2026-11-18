import "server-only";
import { readSheets, at, toNum, toStr, toDateISO, type CellMap } from "./xlsx-read";
import type { GeneralConfig, LtvGrid, EligTier } from "./general";

// Deephaven pricer → GeneralConfig. Uses the Investor NQM (DSCR) side of the "Rate Sheet"
// (base rate/price + two LLPA tables, already 100-based points) and the "Investor NQM Matrix"
// tab for eligibility (max loan tiers, min DSCR, FICO × LTV max).

function findAnchor(
  cells: CellMap,
  match: (s: string) => boolean,
  opts: { minCol?: number; maxRow?: number; maxCol?: number } = {},
): { row: number; col: number } | null {
  const { minCol = 1, maxRow = 60, maxCol = 40 } = opts;
  for (let r = 1; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const v = toStr(at(cells, r, c));
      if (v && match(v)) return { row: r, col: c };
    }
  }
  return null;
}

/** Read an LLPA block: 7 LTV columns to the right of the header anchor; rows below until blank. */
function readBlock(R: CellMap, anchor: { row: number; col: number } | null): LtvGrid {
  const grid: LtvGrid = {};
  if (!anchor) return grid;
  const cols = [1, 2, 3, 4, 5, 6, 7].map((k) => anchor.col + k);
  let started = false;
  for (let r = anchor.row + 1; r <= anchor.row + 40; r++) {
    const label = toStr(at(R, r, anchor.col));
    if (!label) {
      if (started) break;
      continue;
    }
    started = true;
    grid[label] = cols.map((c) => toNum(at(R, r, c)));
  }
  return grid;
}

export async function parseDeephaven(buffer: Buffer, sourceFile: string | null): Promise<GeneralConfig> {
  const sheets = await readSheets(buffer, ["Rate Sheet", "Investor NQM Matrix"]);
  const R = sheets["Rate Sheet"];
  const M = sheets["Investor NQM Matrix"];
  if (!R) throw new Error("Deephaven: 'Rate Sheet' tab not found — is this the Deephaven pricer?");

  // Investor NQM base curve: Rate col G(7), Price col H(8), rows 9..33 (already 100-based).
  const base: [number, number][] = [];
  for (let r = 9; r <= 33; r++) {
    const rate = toNum(at(R, r, 7));
    const price = toNum(at(R, r, 8));
    if (rate != null && price != null) base.push([rate, price]);
  }

  // Investor caps: label col J(10), value col K(11), rows 8..19.
  const caps: Record<string, number | null> = {};
  for (let r = 8; r <= 19; r++) {
    const lab = toStr(at(R, r, 10));
    if (lab) caps[lab] = toNum(at(R, r, 11));
  }
  const minPrice = caps["Minimum Price"] ?? 98;

  // LLPA tables on the Investor (right) side — anchored by header text, col ≥ 20.
  const fico = readBlock(R, findAnchor(R, (s) => s === "FICOxLTV", { minCol: 20 }));
  const other = readBlock(R, findAnchor(R, (s) => s === "Other", { minCol: 20 }));

  // Eligibility from the Investor NQM Matrix: Max Loan B(2), Min DSCR D(4), FICO E(5),
  // Purch F(6), R/T G(7), C/O H(8); carry max-loan / min-DSCR forward across merged blanks.
  const tiers: EligTier[] = [];
  let maxLoan = 0;
  if (M) {
    let curMax = 0;
    let curDscr = 0;
    for (let r = 6; r <= 20; r++) {
      const ml = toNum(at(M, r, 2));
      const md = toNum(at(M, r, 4));
      const fico = toNum(at(M, r, 5));
      if (ml != null) curMax = ml;
      if (md != null) curDscr = md;
      if (fico == null) continue;
      tiers.push({
        max_loan: curMax,
        min_dscr: curDscr,
        fico,
        ltv_purch: toNum(at(M, r, 6)),
        ltv_rt: toNum(at(M, r, 7)),
        ltv_co: toNum(at(M, r, 8)),
      });
      maxLoan = Math.max(maxLoan, curMax);
    }
  }

  const effAnchor = findAnchor(R, (s) => s.toLowerCase().startsWith("effective date"));
  const effCell = effAnchor ? toDateISO(at(R, effAnchor.row, effAnchor.col + 1)) : null;

  return {
    family: "deephaven",
    investor: "Deephaven",
    effective_date: effCell,
    tier: null,
    source_file: sourceFile,
    base_curves: { fixed30: base },
    grids: { fico, other },
    caps,
    min_price: minPrice,
    lock: { d45: caps["45 Day Lock"] ?? null, d60: caps["60 Day Lock"] ?? null },
    eligibility_tiers: tiers,
    min_loan: 100000,
    max_loan: maxLoan || 2500000,
  };
}
