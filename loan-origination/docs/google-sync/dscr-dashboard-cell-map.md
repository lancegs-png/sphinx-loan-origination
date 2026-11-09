# DSCR Deal Dashboard — cell ↔ field map

The contract for two-way sync between the app's field model (`loan_field_values`,
keyed by `field_key`) and the **DSCR Deal Dashboard** Google Sheet. One map per
product; this is DSCR. RTL (fix & flip / new construction / bridge) gets its own
template and its own map.

Source template (read 2026-11): `DSCR Deal Dashboard - Template.xlsx`
(Drive id `1HjfW7tEL_yIug0Ygb8qv3LF0Jgm_kj-S`, in the Architecture Folder).

## Conventions

**Direction** of each field:

- **↔ two-way** — editable on both sides; synced both directions (most inputs).
- **→ app→sheet** — the app owns it; written to the Sheet, never read back
  (loan number, app-calculated values written into plain cells).
- **⊘ formula** — the **Dashboard computes it with its own formula**
  (e.g. DSCR, Monthly PITI, Net Wire). **Never write these cells** — writing
  clobbers the formula. Optionally read one-way into the app later if useful.

**Exact cell addresses (A1) are bound after the dashboard is converted to a
native Google Sheet** — the `.xlsx` read gives layout/labels but not grid
coordinates. Each section below lists label → `field_key` → direction; the
implementation step fills in the `A1` cell for the value next to each label.

**Repeat groups:** `property` and `guarantor` fields use `key#n` (idx 1..N).
The Property Information block is idx 1; the Property Info table is idx 1..10.

---

## Loan Information  (app sections: loan, trade)

| Dashboard field | field_key | Dir |
|---|---|---|
| Loan Number | `loans.loan_number` (col) / `opportunity_number` | → |
| Investor Name | `investor_name` | ↔ |
| Start Date | `application_date` | ↔ |
| Lock Expiration | `lock_expiration_date` | ⊘ (calc) |
| Product Type | `product_type` | ↔ |
| Lock Price | `lock_price` | ↔ |
| Loan Amount | `loan_amount` | → (app-calculated) |
| Servicer | `servicer_name` | ↔ |
| Loan Purpose | `loan_purpose` | ↔ |
| Servicer ID | `servicing_number` | ↔ |
| Rate | `interest_rate` | ↔ |
| Prepay Term | `prepay_term_months` | ↔ |
| Prepay Type | `prepay_type` | ↔ |
| Leverage | `ltv` | ↔ |
| Origination | `origination_fee_pct` | ↔ |
| Loan Term | `loan_term_months` | ↔ |
| Appraised Value | `as_is_value` (property#1) | ↔ |
| Interest Only Months | `io_months` | ↔ |

## Property Information  (property idx 1)

| Dashboard field | field_key | Dir |
|---|---|---|
| Full Address | `property_address` | ⊘ (calc) |
| Street Address | `property_street` | ↔ |
| City | `property_city` | ↔ |
| State | `property_state` | ↔ |
| Zip Code | `property_zip` | ↔ |
| Property Type | `property_type` | ↔ |
| Unit Count | `unit_count` | ↔ |
| Monthly Rent | `monthly_rent` | ↔ |
| Annual Taxes | `annual_taxes` | ↔ |
| Annual Insurance | `annual_insurance` | ↔ |
| Annual HOA | `annual_hoa` | ↔ |
| DSCR | `dscr` | ⊘ (Dashboard formula) |
| Payoff | `payoff_amount` | ↔ |
| Monthly PI Payment | `principal_and_interest` | ⊘ |
| Monthly Taxes | `monthly_taxes` | ⊘ |
| Monthly Insurance | `monthly_insurance` | ⊘ |
| Monthly HOA | `monthly_hoa` | ⊘ |
| Monthly PITI | `monthly_piti` | ⊘ |
| 3 Months (reserve col) | = PITI × `reserve_months` | ⊘ |

## Borrower Information  (borrower, guarantor, contact)

| Dashboard field | field_key | Dir |
|---|---|---|
| Entity Name | `borrower_entity` | ↔ |
| Entity EIN | `entity_ein` | ↔ |
| Guarantor First Name | `guarantor_first_name#1` | ↔ |
| Guarantor Last Name | `guarantor_last_name#1` | ↔ |
| Guarantor Phone | `guarantor_phone#1` | ↔ |
| Guarantor Email | `guarantor_email#1` | ↔ |
| Guarantor Credit | `guarantor_fico#1` | ↔ |
| Guarantor 2 First/Last/Phone/Email/Credit | `guarantor_*#2` | ↔ |
| Title Contact · Name/Email/Phone | `title_contact_name/email/phone` | ↔ |
| Insurance Contact · Name/Email/Phone | `insurance_contact_name/email/phone` | ↔ |

## Processing Checklist  (loan_checklist_items)

Rows under **Borrower Documents** and **Lender Documents**, each: name, Status,
Guidelines, Notes. Match the row's document name → `document_types.name` →
`loan_checklist_items` for the loan.

| Column | Source | Dir |
|---|---|---|
| Document name | `document_types.name` | → (identity/row key) |
| Status | `loan_checklist_items.status` | ↔ |
| Guidelines | `document_types.default_review_rules` | → (reference) |
| Notes | `loan_checklist_items.notes` | ↔ |

**⚠ Status vocabulary mismatch — needs a decision.** Dashboard uses
`Outstanding / Requires Update / Cleared / Approved`; the app uses
`outstanding / ordered / update_needed / approved / not_applicable`. Proposed map:

| Dashboard | app |
|---|---|
| Outstanding | `outstanding` |
| Requires Update | `update_needed` |
| Cleared | `approved` |
| Approved | `approved` |
| _(app only)_ Ordered | → write "Ordered" / nearest |
| _(app only)_ N/A | → write "N/A" |

`Cleared` and `Approved` both landing on `approved` is lossy on the way back —
confirm whether the app should add a distinct `cleared` status, or treat them
as one.

**Third-Parties** sub-list (Title, Appraisal, Insurance, Payoff, Flood Cert,
OFAC, Background, SiteX, Credit Report, CDA, COGS) with a Status each: **no app
store today.** Options: add them as checklist items, add a small
`third_party_orders` store, or leave Dashboard-only for v1. **Decision needed.**

## Property Info table  (property idx 1..10)

| Dashboard column | field_key (#n) | Dir |
|---|---|---|
| Address | `property_address#n` | ⊘ (calc) |
| Original Purchase Price | `original_purchase_price#n` | ↔ |
| Estimated Value | `as_is_value#n` | ↔ |
| Appraised Value | `as_is_value#n` *(or a new `appraised_value`)* | ↔ |
| Loan Amount | per-property share | → |
| Insurance Coverage | `insurance_coverage#n` | ↔ |
| Lease Amount | `monthly_rent#n` | ↔ |
| Lease Start / End | `lease_start_date#n` / `lease_end_date#n` | ↔ |
| Annual Property Tax | `annual_taxes#n` | ↔ |
| Annual Insurance | `annual_insurance#n` | ↔ |

> Note: "Estimated Value" and "Appraised Value" are separate columns but the app
> has only `as_is_value`. Add an `appraised_value` field if they must differ.

## Data Tape  (→ app→sheet, one-way export)

A single investor-delivery row. The app already builds this (`buildDataTapeCsv`
in `src/lib/templates/data-tape.ts`) — reuse that column order and write the row
app→sheet. Not read back (the investor tape is a derived export).

## DSCR Calc  (⊘ formulas)

Inputs (Monthly Rent, Annual Insurance/Taxes/HOA, As-Is Value, LTV, Interest
Rate, Loan Amount, Payoff, Origination, Underwriting Fee, Legal Fee, Escrows,
Cash out) are the **same fields mapped above** — sync those cells. The results
(LTV %, P&I, Monthly Total, DSCR, Interest-Only column) are **Dashboard formulas —
never write.** `underwriting_fee` / `legal_fee` are `manual` fields → ↔.

## Escrow Template  (mostly ⊘)

Inputs: `closing_date` ↔, `disbursement_date` ↔, `first_payment_date` (⊘ calc),
`reserve_months` ↔. Everything else (PI Reserve, Insurance/Tax Impound,
Origination/UW/Legal fees, Prepaid Interest, **Net Wire**) is a Dashboard
formula — never write.

## Closing Process Tasks · Closing Package Review  (out of scope v1)

Workflow checklists (Completed / Links / Notes) with no app store today — e.g.
Stride SharePoint, Eastview purchase, collateral shipping, HUD review. Leave
**Dashboard-only** for v1; revisit with a dedicated closing-tasks store if the
team wants them synced.

---

## Open decisions (carry into the build)

1. **Status vocabulary** — add a distinct `cleared` status, or fold Cleared →
   `approved`?
2. **Third-Parties list** — checklist items, new store, or Dashboard-only?
3. **Estimated vs Appraised value** — add `appraised_value`, or treat as one?
4. **Loan Amount / DSCR source of truth** — app-calculated (write into the
   Dashboard's input cells and let its formulas recompute), confirmed per field.
5. **Conflict rule** — most-recent-edit-wins (needs a per-field `updated_at` on
   both sides; the app already stamps `loan_field_values.updated_at`).
