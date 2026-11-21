# DU 3.2 / MISMO 3.4 export — field-gap map

**Status:** reference for extending the shipped **MISMO 3.4 export**
(`src/lib/templates/mismo.ts`, the "MISMO 3.4 (URLA)" Templates entry). The legacy **DU 3.2 flat
file is retired** — Fannie Mae's AUS stopped accepting it on 2022-03-01 and replaced it with the
MISMO 3.4 model — so we build only MISMO 3.4. This map records which 1003/URLA data points we emit
today and which need new dictionary fields first. The mapper omits (never fabricates) anything we
don't capture, so the file grows as fields are added.

## TL;DR

- **DU 3.2** (Fannie Mae's legacy flat `.fnm` text file) and **MISMO 3.4** (the modern URLA XML,
  a.k.a. ULAD) carry the *same* dataset — the Uniform Residential Loan Application (Form 1003).
  DU 3.2 is a fixed-layout text record; MISMO 3.4 is XML. Map once, serialize twice.
- We already capture **most loan- and property-level** data points. The gaps are almost entirely
  on the **borrower/personal** side, because the 1003 is a *consumer* mortgage form and our deals
  are **business-purpose, entity-borrower DSCR/bridge** loans.
- **Three buckets of gaps:**
  1. **Already in the schema, but populated from the library, not intake** — guarantor **SSN, DOB,
     mailing address** and the **entity mailing address** were **added by the parties-library
     migration `0024_parties.sql`** and are **lender-only**. They're filled from the
     Guarantor/Entity library (manual / copy-into-loan), *not* from borrower intake, and the
     mailing address is a **single free-text column** — DU wants parsed street/unit/city/state/zip.
     So the fields exist; the residual work is making sure they're populated and parseable.
  2. **Add a handful of constants/enums** — occupancy = *Investment*, mortgage type =
     *Conventional*, amortization normalized to *Fixed/ARM*, originator NMLS IDs, and a
     **Declarations** block (mostly defaultable to "No").
  3. **Structural, defer-able for DSCR** — itemized **employment/income**, itemized
     **assets/liabilities**, and the per-property **REO schedule**. DSCR qualifies on property
     cash flow, so these can ship **empty or aggregated** for a business-purpose file; a clean
     AUS/underwrite run on the investor side may still want at least an aggregate asset row and the
     REO count, so expect validation rounds.

## The DSCR wrinkle (read first)

The 1003/URLA assumes an **individual** borrows to buy/refi a **1-4 unit home they'll live in or
rent**, qualified on **their** income, assets, and liabilities. Our deals are:

- **Entity borrower** (LLC/Corp/Trust/LP) with one or more **personal guarantors**.
- **Business purpose / investment** — no consumer income qualification; the property's rent
  carries the debt (DSCR).

So the export maps:

| 1003 concept | We supply |
|---|---|
| Borrower (the person) | **Guarantor** (`guarantor_*`, repeat group, idx 1..N) |
| Vesting / title / "Legal Entity" party | **Borrowing entity** (`borrower_entity`, `entity_*`) |
| Occupancy | **Investment Property** (constant) |
| Income / employment | *omitted or zeroed* (business purpose) |

> **MISMO 3.4** has a first-class non-person **LEGAL_ENTITY** party, so the entity rides along
> properly. **DU 3.2** flat file has no entity concept — the entity name goes in the vesting/title
> text and the guarantor is the borrower of record. Note this asymmetry when we build the two
> serializers.

## Where the data lives today (so the mapper knows what to read)

- **`loan_field_values`** — the dictionary-driven store. One row per (loan, field_key, idx), with
  `initial_value` and `verified_value`; **current = `verified_value ?? initial_value`**. Guarantor
  fields repeat by `idx` (`repeat_group='guarantor'`), property fields by `repeat_group='property'`.
  This is where `term-sheet/data.ts` reads via its `cur("field_key")` helper — the DU/MISMO mapper
  should do the same.
- **`loans`** columns — stage, `loan_number`, `opportunity_number`, `loan_amount`, etc.
- **`loans.custom_fields`** (jsonb) — includes `intake_snapshot` (the immutable intake capture).
- **Sensitive PII** (SSN/DOB/mailing) is seeded `lender_only=true`, so `loan_field_values` RLS hides
  it from borrower/broker logins. The serializer runs server-side with the service role.

### Data-plumbing caveats (confirmed in code)

- **Dictionary source drift.** The committed seed `scripts/out/field_definitions.json` (from
  "Sphinx Loan Data Dictionary v0.6.xlsx", 122 rows) is **older than the live Program Config sheet**
  (138 rows, which I read for this map). Four borrower fields —
  **`liquid_assets`, `net_worth`, `properties_owned_count`, `experience_summary`** — are in the
  **sheet and the intake form but NOT in the committed JSON seed.** `writeIntakeFields()` silently
  drops any intake key with no matching `field_definitions` row, so depending on whether the live DB
  was re-imported from the newer sheet, these may **not be persisted as field values** — they do
  land in **`custom_fields.intake_snapshot`** regardless. The URLA mapper should **read the intake
  snapshot as a fallback** for these four (and we should reconcile the seed vs. sheet separately).
- **The SSN/DOB/mailing fields come from the library, not intake** (migration 0024). A deal with no
  linked guarantor record will have these empty even post-intake.
- **Multi-member ownership** beyond ~2 guarantors isn't modeled as flat fields — it lives in the
  `entity_members` library table + the `guarantor_ownership_pct` repeat. MISMO can carry N owners;
  the mapper reads `entity_members`.

---

## Coverage summary

| URLA / 1003 section | Present | Derivable / constant | **Needs-new** | N/A for DSCR* |
|---|---|---|---|---|
| 4. Loan & subject property | ●●●●● | ●● | – | – |
| 1a. Borrower personal info | ●●●● (SSN/DOB/addr via `0024`) | ● | **address parse, middle/suffix, marital** | dependents, housing hist. |
| 1b–1e. Employment & income | – | – | *(consumer only)* | **all** (business purpose) |
| 2. Assets & liabilities | aggregate only | – | itemized rows | itemized (optional) |
| 3. Real estate owned (REO) | count only | – | **REO schedule** | detail (optional) |
| 5. Declarations | – | mostly default "No" | **declarations block** | – |
| 7. Military | – | default No | – | ✓ |
| 8. Demographic (HMDA) | – | "not provided" | – | ✓ (business-purpose exempt) |
| 9. Loan originator | partial | **NMLS constants** | NMLS IDs | – |
| Entity / vesting | ●●●● | – | **entity mailing addr** | – |

\* "N/A for DSCR" = legitimately omitted or defaulted on a business-purpose investment file; becomes
"needs-new" only if we ever originate consumer/owner-occupied loans.

---

## Section-by-section mapping

Legend — **✓ present** · **~ present, needs transform** · **⊕ derivable/constant** · **✗ needs-new** · **▢ N/A for DSCR**

### Section 4 — Loan & subject property

| DU / URLA field | Dictionary key | Status |
|---|---|---|
| Loan amount | `loan_amount` | ✓ |
| Loan purpose (Purchase / Refinance / Construction) | `loan_purpose` | ~ map enum (our "Refinance - Cash Out" → Refi + CashOut=Yes) |
| Note rate | `interest_rate` | ✓ |
| Loan term (months) | `loan_term_months` | ✓ |
| Amortization type (Fixed / ARM / Other) | `amortization_type` (free text), `io_months`, `fixed_period_months` | ~ normalize to enum |
| Mortgage type (Conventional/FHA/VA/USDA) | — | ⊕ constant **Conventional** |
| Lien position | `lien_position` | ✓ |
| Subject property street/city/state/zip | `property_street` / `_city` / `_state` / `_zip` | ✓ |
| County | `property_county` | ✓ |
| Number of units | `unit_count` | ✓ |
| Property value (appraised/estimated) | `as_is_value` (DSCR) / `arv` (RTL) | ✓ |
| Property type | `property_type` | ~ map to ULAD enum (Detached/Attached/Condominium/…) |
| Occupancy (Primary/Second/**Investment**) | — | ⊕ constant **Investment** |
| Mixed-use | `property_type` = "Mixed Use" | ⊕ derivable |
| Manufactured home | — | ⊕ constant **No** |
| Construction / C-to-P | `loan_program`, `rehab_type`, `project_months` | ⊕ derivable |
| Refi: original price / date / improvements | `original_purchase_price` / `original_purchase_date` / `improvements_since_purchase` | ✓ |
| Expected monthly rental income (investment) | `monthly_rent` | ✓ |
| Subject taxes / insurance / HOA (annual + monthly) | `annual_taxes`/`monthly_taxes`, `annual_insurance`/`monthly_insurance`, `annual_hoa`/`monthly_hoa` | ✓ |

### Section 1a — Borrower (= guarantor) personal information

| DU / URLA field | Dictionary key | Status |
|---|---|---|
| First name | `guarantor_first_name` | ✓ |
| Middle name | — | ✗ (optional) |
| Last name | `guarantor_last_name` | ✓ |
| Suffix | — | ✗ (optional) |
| **SSN / TIN** | `guarantor_ssn` | ~ **exists (`0024`)**, lender-only, filled from library not intake |
| **Date of birth** | `guarantor_date_of_birth` | ~ **exists (`0024`)**, lender-only, filled from library not intake |
| Citizenship | `guarantor_citizenship` | ~ map (US / Permanent Resident / Foreign National → URLA codes) |
| ITIN indicator | `itin_flag` | ✓ |
| Type of credit (Individual / Joint) | — | ⊕ derivable (count guarantor idx) |
| Marital status | — | ✗ (DU-required; default *Unmarried* if not collected) |
| Dependents (count/ages) | — | ▢ / ✗ |
| Cell / home phone | `guarantor_phone` | ~ one phone → Cell |
| Work phone | — | ▢ |
| Email | `guarantor_email` | ✓ |
| **Current mailing address** (street/unit/city/state/zip) | `guarantor_mailing_address` | ~ **exists (`0024`)** but is **one free-text column** — DU needs parsed street/unit/city/state/zip |
| Years/months at address; housing (own/rent/rent amt) | — | ✗ / default (DU wants it; defaultable) |
| Former address (if < 2 yr) | — | ▢ / ✗ |

### Sections 1b–1e — Employment & income

| DU / URLA field | Dictionary key | Status |
|---|---|---|
| Employer name / address / phone | — | ▢ (business purpose) |
| Position, start date, years in line of work | — | ▢ |
| Self-employed, ownership % of business | `guarantor_ownership_pct` is *entity* ownership, not employer | ▢ |
| Monthly income (base / OT / bonus / commission / other) | — | ▢ |
| Other income sources | — | ▢ |

> DSCR files submit **no income**. DU/MISMO carry empty employment; many investor DU workflows run
> these on a "no-ratio"/investor path. If we ever do **consumer** loans, this whole block becomes
> needs-new.

### Section 2 — Assets & liabilities

| DU / URLA field | Dictionary key | Status |
|---|---|---|
| Aggregate liquid assets | `liquid_assets` | ~ aggregate; **read from `intake_snapshot`** (see drift caveat) |
| Combined net worth | `net_worth` | ~ aggregate; **read from `intake_snapshot`** (see drift caveat) |
| **Itemized assets** (type, institution, acct #, value) | — | ✗ (map `liquid_assets` to one "CashOrMarketValue" row for a minimal file) |
| **Itemized liabilities** (company, acct #, balance, monthly pmt, payoff) | — | ✗ (optional for DSCR; needed for a full AUS run) |
| Other liabilities/expenses (alimony, child support) | — | ▢ |

### Section 3 — Real estate owned (REO schedule)

| DU / URLA field | Dictionary key | Status |
|---|---|---|
| Count of investment properties owned | `properties_owned_count` | ~ count; **read from `intake_snapshot`** (see drift caveat) |
| Experience count (flips/rentals, 3 yr) | `experience_property_count` | ✓ |
| **Per-property schedule** (address, value, status, occupancy, taxes/ins/HOA, associated mortgage: creditor/acct/payment/balance/type, rental income, net rental) | — | ✗ **biggest structural gap** — no object exists |

### Section 5 — Declarations (a–m)

| DU / URLA declaration | Status |
|---|---|
| Will occupy as primary residence | ⊕ constant **No** (investment) |
| Ownership interest in property last 3 yrs | ⊕ derivable / default |
| Family/business affiliation with seller | ✗ / default No |
| Borrowing undisclosed money | ⊕ default No |
| Other mortgage on this property / applying for other credit | ⊕ derivable / default No |
| Property subject to PACE/clean-energy lien | ⊕ default No |
| Co-maker/guarantor on undisclosed note | ⊕ default No |
| Outstanding judgments | ✗ / default No |
| Delinquent federal debt | ⊕ default No |
| Party to a lawsuit | ✗ / default No |
| Conveyed title in lieu of foreclosure (7 yr) | ⊕ default No |
| Pre-foreclosure / short sale (7 yr) | ⊕ default No |
| Property foreclosed (7 yr) | ⊕ default No |
| Declared bankruptcy (7 yr, chapter) | ✗ / default No |

> A clean file can **default the whole block to "No"**, but bankruptcy / foreclosure / judgments /
> lawsuits are **underwriting-material** — worth capturing as a small **Declarations** block
> (yes/no set) rather than silently defaulting.

### Sections 7–9 — Military / Demographic / Originator

| DU / URLA field | Status |
|---|---|
| Military service | ⊕ default No |
| Ethnicity / sex / race (HMDA) | ▢ business-purpose investment loans are **HMDA-exempt** → "Information not provided" |
| Loan originator name | partial (originator user on the loan) |
| **Loan originator NMLS ID** | ✗ constant/config |
| **Company (Sphinx) NMLS ID**, org name/address | ✗ constant/config |

### Entity / vesting (MISMO LEGAL_ENTITY; DU vesting text)

| Field | Dictionary key | Status |
|---|---|---|
| Entity legal name | `borrower_entity` | ✓ |
| EIN | `entity_ein` | ✓ |
| Entity type (LLC/Corp/Trust/LP) | `entity_type` | ✓ |
| State of formation | `entity_state` | ✓ |
| **Entity mailing address** | `entity_mailing_address` | ~ **exists (`0024`)**, single free-text column |

---

## Consolidated "needs-new" list

Ordered by how much they block a basic importable DU 3.2.

**Tier 1 — already in the schema (`0024_parties.sql`), residual work only:**
- `guarantor_ssn`, `guarantor_date_of_birth`, `guarantor_mailing_address`, `entity_mailing_address`
  **exist** but need: (a) the mailing addresses exposed as **parsed street/unit/city/state/zip**
  (DU won't take one free-text line), and (b) **population guaranteed** — they fill from the
  Guarantor/Entity library, so a deal with no linked record will be empty. No new columns strictly
  required; a parse step + a "require guarantor record before export" check.

**Tier 2 — small constants/enums + a declarations block (cheap, unblocks a clean file):**
- Config constants: `nmls_loan_originator_id`, `nmls_company_id` (Sphinx), originator name/phone.
- Derived/constant at serialize time (no new dictionary field strictly needed): occupancy =
  Investment, mortgage type = Conventional, amortization Fixed/ARM, marital default Unmarried,
  Section 5 defaults.
- Optional new fields: `guarantor_middle_name`, `guarantor_suffix`, `guarantor_marital_status`.
- **Declarations block** — ~6 booleans worth capturing (bankruptcy, foreclosure, deed-in-lieu,
  judgments, lawsuit, delinquent federal debt).

**Tier 3 — structural, defer for DSCR (needed only for a full AUS/consumer file):**
- Itemized **assets** and **liabilities** (map aggregates to single rows for a minimal file).
- Per-property **REO schedule** object.
- **Employment & income** block (only if consumer/owner-occupied loans are ever added).

## What shipped, and what to extend

The **MISMO 3.4 export is live**: `src/lib/templates/mismo.ts` (`buildMismoXml`), served as the
"MISMO 3.4 (URLA)" entry through the existing `/api/loans/[id]/template/[id]` route (new `xml`
format). It emits the loan, subject property, the guarantor as the URLA Borrower, and the entity as
a `LEGAL_ENTITY` party, with occupancy = Investment and mortgage type = Conventional. Anything we
don't capture is omitted, never faked — so the document grows field by field.

Highest-value additions next, to make a file an AUS/investor accepts more readily:
- **Tier 2 (small):** parse the mailing addresses into components; populate the guarantor
  SSN/DOB (already in the dictionary via `0024`) so the Borrower party carries identity; a
  defaulted Declarations block.
- **Tier 3 (structural):** itemized assets/liabilities, the per-property REO schedule, and
  employment/income — only if consumer/owner-occupied loans are ever added. Today's aggregates
  (`liquid_assets`, `net_worth`, `properties_owned_count`) can be read from the intake snapshot.

Expect **validation rounds** with whichever investor/AUS consumes the file — business-purpose DSCR
imports commonly flag empty employment/REO even when the loan doesn't qualify on them, and ULAD
enumerations are fussy. Extend the one mapper (`mismo.ts`); the per-element mapping below is the
checklist for what each new dictionary field unlocks.
