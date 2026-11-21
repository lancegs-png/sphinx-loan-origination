# Borrower Loan Application — Field Map

This maps every field in **Loan Application 2026.pdf** (357 PDF fields across 11 sections) to the app,
so we can (a) prefill from what's already known, (b) persist only the operationally useful subset into
the field dictionary, and (c) fill + flatten the PDF at the end.

**How to read this**

- **Reuse** = an existing `field_definitions` key. Prefills automatically; the borrower sees it filled.
- **NEW-dict** = a new `field_definitions` key (migration `0033_borrower_application.sql`).
- **Snapshot** = stored only in `loans.custom_fields.application_snapshot` + rendered into the PDF.
- **Req**: `R` required, `O` optional, `R*` conditionally required (condition in Notes). Declarations are
  `R` to answer; their explanation is `O` unless the answer is "Yes".

**Co-guarantor** = guarantor repeat-group row #2 (`idx=2`). **Multiple properties** = `property_*` `idx≥2`.

**Purpose/type:** the PDF's purpose checkboxes collapse to the existing `loan_purpose` + `rehab_type`
selects (what pricing/program derivation reads).

---

## Section 1 — Borrowing Entity

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Borrowing Entity Legal Name | Reuse | `borrower_entity` | text | R | prefilled |
| EIN | Reuse | `entity_ein` | text | R | |
| Entity Member Name(s) | NEW-dict (repeat) | `entity_member_name` + `entity_member_pct` | text/percent | R* | queryable repeat group `entity_member` |

## Section 2 — Property & Purpose

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Street / City / State / Zip | Reuse | `property_street` / `property_city` / `property_state` / `property_zip` | text | R | property row #1 |
| Purpose of Loan | Reuse | `loan_purpose` + `rehab_type` | select | R | |
| Property Type | Reuse | `property_type` | select | R | |
| Number of Units | Reuse | `unit_count` | number | R* | if multi-unit |
| Number of Properties (portfolio) | NEW-dict | `portfolio_property_count` | number | R* | if portfolio |
| Exit Strategy | Reuse | `exit_strategy` | select | R | |
| Expected Timeline to Exit | NEW-dict | `exit_timeline_months` | number | O | |

## Section 3 — Purchase details *(if purchase)*

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Expected Closing Date | Reuse | `closing_date` | date | R* | |
| Purchase Price | Reuse | `purchase_price` | currency | R* | |
| As-Is Value | Reuse | `as_is_value` | currency | R* | |
| Expected ARV | Reuse | `arv` | currency | R* | if reno/construction |
| Renovation Budget | Reuse | `rehab_budget` | currency | R* | if reno/construction |
| Renovation Timeframe | Reuse | `project_months` | number | O | |
| Describe Improvements | NEW-dict | `improvements_description` | text | O | |

## Section 4 — Refinance details *(if refinance)*

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Date Acquired | Reuse | `original_purchase_date` | date | R* | |
| Original Purchase Price | Reuse | `original_purchase_price` | currency | R* | |
| Current Lender | NEW-dict | `existing_lender_name` | text | O | |
| Loan Maturity Date | NEW-dict | `existing_loan_maturity_date` | date | O | |
| As-Is Value | Reuse | `as_is_value` | currency | R* | |
| Existing Payoff Amount | Reuse | `payoff_amount` | currency | R* | |
| Renovation Budget / Timeframe | Reuse | `rehab_budget` / `project_months` | currency/number | O | |
| Describe Improvements | NEW-dict | `improvements_description` | text | O | |

## Section 5 — Guarantor & Co-guarantor *(co-guarantor = guarantor idx 2)*

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Guarantor's Name | Reuse | `guarantor_first_name` + `guarantor_last_name` | text | R | |
| Social Security # | NEW-dict (sensitive) | `guarantor_ssn` | text | R | **lender_only**, masked, broker-hidden; entered via service-role submit |
| Date of Birth | NEW-dict | `guarantor_dob` | date | R | **lender_only** |
| Phone / Email | Reuse | `guarantor_phone` / `guarantor_email` | text/email | R | |
| Present Address | NEW-dict | `guarantor_address` | text | R | |
| Marital Status | NEW-dict | `guarantor_marital_status` | select | R | Married / Unmarried |
| Ownership Type | NEW-dict | `guarantor_residence_ownership` | select | R | Own / Rent |
| Years at Present Address | NEW-dict | `guarantor_years_at_address` | number | R | |
| Credit Score | Reuse | `guarantor_fico` | number | R | self-reported, verified later |
| Citizenship (asked §8) | Reuse | `guarantor_citizenship` | select | R | |

## Section 6 — Assets & Income

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Accounts table | **Snapshot** | `assets[]` | — | O | repeating; not first-class |
| TOTAL LIQUIDITY | Reuse | `liquid_assets` | currency | R | |
| Employer | NEW-dict | `guarantor_employer` | text | R | repeat=guarantor |
| Occupation | NEW-dict | `guarantor_occupation` | text | R | repeat=guarantor |
| Annual Income | NEW-dict | `guarantor_annual_income` | currency | R | repeat=guarantor |
| Annual Investment Income | NEW-dict | `guarantor_investment_income` | currency | R | repeat=guarantor |

## Section 7 — Real Estate Owned & Experience

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Geographic areas | NEW-dict | `experience_geography` | text | O | |
| Capacity | NEW-dict | `experience_capacity` | text | O | |
| Q1 Rehabbed (3y) | Reuse | `experience_property_count` | number | R | |
| Q2 Rentals owned | Reuse | `properties_owned_count` | number | R | |
| Q3 Ground-up (3y) | NEW-dict | `experience_groundup_count` | number | O | |
| Q4 Ever purchased & rehabbed | NEW-dict | `experience_total_rehab_count` | number | R | |
| Q5 Years investing | NEW-dict | `experience_years` | number | R | |
| Q6 Licensed contractor/agent | NEW-dict | `experience_licensed` | select | O | Yes/No |
| Q7 Company website | NEW-dict | `company_website` | text | O | |
| Real Estate Owned / Sold tables | **Omitted from form** | — | — | — | Collected separately; PDF gets "See attached" in the first cell of each. |

## Section 8 — Personal Declarations *(per guarantor, Yes/No)*

Snapshot booleans (`declarations.personal`), each `R` to answer; explanation `R*` if any "Yes".
Judgments · Bankruptcy (4y) · Foreclosure/deed-in-lieu (4y) · Party to a lawsuit · Obligated on a loan
that foreclosed · Delinquent on federal debt · Felony · U.S. citizen · Permanent resident alien.
The citizenship answers also write **`guarantor_citizenship`**.

## Section 9 — Property Declarations *(Yes/No)*

Snapshot booleans (`declarations.property`), `R` to answer: occupy/intend · ever occupied · under
construction · hazards · relationship with seller/closing/title · bought from wholesaler · down payment
borrowed · subject to short-sale approval.

## Section 10 — Additional Information

| PDF field | Mapping | Key | Type | Req | Notes |
|---|---|---|---|---|---|
| Additional commentary | Reuse | `loan_request_summary` | text | O | |
| Additional entity members | NEW-dict (repeat) | `entity_member_*` | — | O | §1 |
| Additional properties | Reuse (repeat) | `property_*` idx≥2 | — | R* | if portfolio |

## Section 11 — Acknowledgment & Signatures

E-signature step: guarantor (+ co-guarantor) signatures captured with the same authentication-record
pattern as the term sheet (name, email, IP, UTC timestamp, consent), rendered into the PDF signature
block + an appended authentication certificate.

---

## New dictionary fields (migration 0033) — ~23

`entity_member_name`, `entity_member_pct`, `portfolio_property_count`, `exit_timeline_months`,
`existing_lender_name`, `existing_loan_maturity_date`, `improvements_description`, `guarantor_ssn`
(lender_only), `guarantor_dob` (lender_only), `guarantor_address`, `guarantor_marital_status`,
`guarantor_residence_ownership`, `guarantor_years_at_address`, `guarantor_employer`,
`guarantor_occupation`, `guarantor_annual_income`, `guarantor_investment_income`,
`experience_geography`, `experience_capacity`, `experience_groundup_count`,
`experience_total_rehab_count`, `experience_years`, `experience_licensed`, `company_website`.

Snapshot-only: `assets[]`, `declarations.personal`, `declarations.property`. REO tables omitted.

## Required-vs-optional

- **Always required:** entity name + EIN, property address, property type, purpose, all guarantor fields,
  liquid assets, net worth, employer/occupation/annual income/investment income, experience Q1/Q2/Q4/Q5,
  all declaration yes/no answers.
- **Conditionally required:** purchase block (if purchase), refi block (if refi), ARV + rehab budget (if
  reno/construction), units (if multi-unit), portfolio count + extra property rows (if portfolio), the
  co-guarantor block (if a co-guarantor is added), a declaration explanation (if any "Yes").
- **Optional:** experience Q3/Q6/Q7 + geography + capacity, asset table, additional entity members,
  additional commentary, exit timeline.
