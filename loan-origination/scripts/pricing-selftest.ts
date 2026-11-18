// Offline check that the sizer parsers + engine reproduce the spreadsheets' own math.
// Run:  node --conditions=react-server --import tsx scripts/pricing-selftest.ts <EV.xlsx> <DH.xlsx>
import { readFile } from "node:fs/promises";
import { parseEastview } from "../src/lib/pricing/parse-eastview";
import { parseDeephaven } from "../src/lib/pricing/parse-deephaven";
import { priceQuote, type QuoteParams } from "../src/lib/pricing/general";

const [, , evPath, dhPath] = process.argv;

const baseParams: QuoteParams = {
  mode: "rate",
  rate: 0.07,
  rateType: "fixed30",
  prepay: "5yr",
  lockDays: 30,
  loanAmount: 360000,
  propertyValue: 450000, // 80% LTV
  fico: 700,
  purpose: "purchase",
  property: "sfr",
  monthlyRent: 6500,
  annualTaxes: 12000,
  annualInsurance: 3500,
  annualHOA: 0,
  termMonths: 360,
  interestOnly: false,
  foreignNational: false,
  firstTimeInvestor: false,
};

let failures = 0;
function check(name: string, got: number | null, want: number, tol = 1e-3) {
  const ok = got != null && Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, want ${want}`);
}

async function main() {
  const ev = await parseEastview(await readFile(evPath), "EV.xlsx");
  const dh = await parseDeephaven(await readFile(dhPath), "DH.xlsx");

  console.log("\n== Eastview config ==");
  console.log("effective", ev.effective_date, "tier", ev.tier, "minPrice", ev.min_price, "maxLoan", ev.max_loan);
  console.log("base fixed30 rows", ev.base_curves.fixed30?.length, "lev rows", ev.leverage?.rows.length);
  console.log("grids", Object.fromEntries(Object.entries(ev.grids).map(([k, v]) => [k, Object.keys(v!).length])));

  const q = priceQuote(ev, baseParams);
  console.log("EV example:", q.adjustments.map((a) => `${a.label}=${a.value}`).join("  "));
  console.log(`  base ${q.basePrice}  net ${q.netPrice}  points ${q.points}  maxLtv ${q.maxLtv}  maxLoan ${q.maxLoan}  eligible ${q.eligible}`);
  check("EV exit price (net)", q.netPrice, 97.556);
  check("EV base price @7%", q.basePrice, 98.056);
  check("EV max LTV (700-719 purchase)", q.maxLtv, 80);

  // target-price inversion: feed the solved price back, expect ~7%
  const inv = priceQuote(ev, { ...baseParams, mode: "targetPrice", rate: undefined, targetPrice: 97.556 });
  console.log(`EV invert: targetPrice 97.556 -> rate ${(inv.rate * 100).toFixed(3)}%  net ${inv.netPrice}`);
  check("EV inverted rate ~7%", inv.rate, 0.07, 2e-3);

  console.log("\n== Deephaven config ==");
  console.log("effective", dh.effective_date, "minPrice", dh.min_price, "maxLoan", dh.max_loan);
  console.log("base rows", dh.base_curves.fixed30?.length, "fico rows", Object.keys(dh.grids.fico!).length, "other rows", Object.keys(dh.grids.other!).length, "elig tiers", dh.eligibility_tiers?.length);
  console.log("caps", JSON.stringify(dh.caps));

  const d = priceQuote(dh, { ...baseParams, rate: 0.075, fico: 740, propertyValue: 520000 /* ~69.2% */ });
  console.log("DH sanity:", d.adjustments.map((a) => `${a.label}=${a.value}`).join("  "));
  console.log(`  base ${d.basePrice}  net ${d.netPrice}  points ${d.points}  maxLtv ${d.maxLtv}  maxLoan ${d.maxLoan}  eligible ${d.eligible}  issues ${d.issues.join("; ")}`);
  check("DH base price @7.5%", d.basePrice, 102.014);
  // base 102.014 + fico(740@65-70 −0.125) + purchase 0.1 + 5yr prepay 0.625 + DSCR≥1.25 0.25
  check("DH net (manual 102.864)", d.netPrice, 102.864, 1e-2);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
