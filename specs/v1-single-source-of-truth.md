# v1 — Single Source of Truth (field model, calculations, templates, Sheet mirror)

Addendum to `tasks.md` (extends it with phases **P14–P22**). Source inputs:
`claude-code-brief-field-values.md` and `Sphinx Loan Data Dictionary v0.6.xlsx`
(tabs: Field Dictionary, Template Map, Checklists, Data Tape Map, Issues Found,
Open Questions, Template Fixes).

**Goal:** the Supabase loan record is the one source of truth for every deal, and
`app_settings` the one source for company config. Everything else — the portal UI,
the per-deal Google Sheet, every template, and the data tape — reads from and writes
to that record. Values are entered manually in v1 (chat, portal UI, or the Sheet).

---

## A. Conflicts with the current code (resolve before writing migrations)

The brief asked for this review. Current code = schema migrations `0001–0008`,
`saveLoanField`, the quote panel, and the term-sheet PDF route.

1. **Field-key names in code don't match the dictionary.** The dictionary is the
   single registry, so the code keys must be renamed to it:
   | Current key (in code) | Dictionary key | Where used today |
   |---|---|---|
   | `guarantor_credit` | `guarantor_fico` (repeat group `guarantor`) | quote-panel, term-sheet route |
   | `entity_name` | `borrower_entity` | quote-panel, term-sheet route, intake |
   | `property_value` (fallback) | `as_is_value` (no `property_value` in dict) | quote-panel, term-sheet route |
   | `origination_pct` (quote blob) | `origination_fee_pct` | quote-panel, term-sheet route |
   | quote blob `pitia` | `monthly_piti` (now a calculated field) | quote blob, term-sheet route |
   | `ltv`, `dscr` (quote blob) | calculated fields (same names) | quote blob |
   Guarantor names are stored flat today (`guarantor_first_name`); the dictionary
   keeps the base key but adds a repeat index (`idx`). Base key is compatible.

2. **`loans.custom_fields` conflicts with the new `loan_field_values` store.**
   `saveLoanField` currently writes every non-core, non-trade value into
   `custom_fields` as free-form JSON with no key validation — exactly the gap the
   brief's FK closes. New writes move to `loan_field_values` (FK →
   `field_definitions.key`). Migration: copy existing `custom_fields` scalars into
   `loan_field_values.initial_value`; repoint `saveLoanField`, the Loan Data UI,
   the quote panel, the term-sheet route, and intake. Leave `quote` / `term_sheet`
   blobs in `custom_fields` for now (flagged — see Decision D5).

3. **Core columns invert direction.** `CORE_COLUMNS` today writes `loan_type,
   loan_amount, property_address, borrower_name, expected_close_date` straight onto
   `loans`. The brief keeps `loan_amount, property_address, borrower_name` as
   **summary columns synced *from* `loan_field_values` by trigger** — field values
   become authoritative, columns become derived. Reconcile the two odd ones:
   `loan_type` ≈ `loan_program` (enum DSCR/RTL); there is no `expected_close_date`
   in the dictionary (use `closing_date`). See Decision D2.

4. **`doc_status` enum is too small.** Current: `outstanding, update_needed,
   approved`. Needed: add `ordered` and `not_applicable`. "Cleared" maps to
   `approved` (no separate value — confirmed decision #4). `ALTER TYPE ... ADD VALUE`
   must run outside a transaction block.

5. **`field_definitions` needs new columns** (none conflict; all additive):
   `verifiable, repeat_group, programs text[], required_stage loan_stage, source,
   calc_key`. `lender_only` already exists — keep (trade fields stay lender-only).
   Add `contact` to the documented `section` values and to the `FieldDef` TS union
   (`loan | property | borrower | guarantor | trade | contact`).

6. **DSCR pricing engine (`program_pricing.model.engine`) overlaps the calc module.**
   It already computes ltv / dscr / pitia / points. To avoid two sources of truth,
   the calc module (P16) owns the borrower-facing calculated fields (ltv, dscr,
   monthly_piti, …) and writes them to `loan_field_values` (read-only); the engine's
   **pricing** output (net price / points — internal) stays as-is. Reuse the engine's
   math; don't duplicate it.

7. **Templates: `{{key}}` supersedes `#hashtag`.** The term-sheet route fills from the
   `custom_fields.quote` blob today; the LOI/commitment templates must fill from
   `loan_field_current` via `{{key}}`. Keep `field_definitions.hashtag` working as a
   backward-compatible alias only.

8. **`loan_trade.values` becomes redundant.** Trade-section values can live in
   `loan_field_values` with `lender_only` RLS, which the brief's model already
   supports. Fold trade into `loan_field_values` and retire `loan_trade` (migrate
   first). See Decision D3.

9. **`loan_programs` list is wider than the two active programs.** History seeded
   Bridge / Fix&Flip / New Construction / DSCR / Commercial, etc. The dictionary's
   `programs text[]` uses loan_type_keys **DSCR** and **RTL** only (Multifamily →
   DSCR). Reconcile the active program set. See Decision D4.

10. **No stage-gating today.** `required_stage` and verified-only template refusal are
    new; they layer on top of the existing "stage advance needs admin approval" rule
    (not a conflict, just additive).

### Decisions still needed from Lance
- **D1 — Retire `loan_trade`** and fold trade values into `loan_field_values`
  (lender-only RLS)? (Recommended: yes — one value store.)
- **D2 — `loans.loan_type` / `expected_close_date` columns:** repoint `loan_type` →
  `loan_program`, and drop `expected_close_date` in favor of the `closing_date`
  field (keep a synced summary column if list views need it)?
- **D3 — Core summary columns:** keep exactly `loan_amount, property_address,
  borrower_name` as trigger-synced summaries (brief's list); add `loan_program` and
  `closing_date`/stage for the pipeline view?
- **D4 — Active programs:** confirm only **DSCR** and **RTL** are live now; archive the
  others in `loan_programs`?
- **D5 — `quote` / `term_sheet` blobs:** leave in `custom_fields` for now (brief says
  flag it), or migrate `quote` into the initial values of the pricing fields? The
  quote's ltv/dscr/pitia become calculated fields, so the blob is largely redundant
  once P16 lands.
- **D6 — Repeat groups UI:** property & guarantor repeats (`idx`) — portfolio deals.
  Confirm max expected (affects Sheet layout and data-tape columns, which currently
  map guarantor 1 & 2 and one property row per export line).

---

## B. Field model (foundation for everything below)

### `field_definitions` (extend; migration adds columns)
Existing: `key, label, section, type, options, hashtag, lender_only, sort`.
Add: `verifiable bool default false`, `repeat_group text null` (`property` |
`guarantor`), `programs text[] default '{}'` (empty = all; else loan_type_keys),
`required_stage loan_stage null`, `source text` (`intake | manual | calculated |
system | config`), `calc_key text null` (calculated fields are read-only).

**Seed from the Field Dictionary tab** (134 rows): `Tag`→`key`, `Label`→`label`,
`Supabase section`→`section`, `Type`→`type` (integer/decimal→`number`, enum→`select`
with `options` from "Allowed values", long text/email/phone→`text`),
`Initial / Verified` contains "verified"→`verifiable=true`, `Supabase stage`→
`required_stage`, `Program`→`programs` (`Both`→`{}`, else `{DSCR}`/`{RTL}`),
`Source`→`source`, `Formula`→drives `calc_key`. Tags ending `_n_`
(`guarantor_n_fico`) seed as the base key (`guarantor_fico`) with
`repeat_group='guarantor'`. **Skip rows whose `section` is `app_settings`** — those
go to `app_settings` (P19). `source=config` fields (note_buyer_*) read from
`app_settings` but may be overridden per loan.

### `loan_field_values` (new — replaces new writes to `custom_fields`)
`loan_id uuid→loans`, `field_key text→field_definitions.key` (**FK validates keys**),
`idx int default 1`, `initial_value jsonb`, `verified_value jsonb` (only when the
field is `verifiable`), `locked bool default false`, `locked_by/locked_at`,
`updated_by/updated_at`. **PK (loan_id, field_key, idx).**

**Database-enforced rules (triggers, not just app code):**
- `locked=true` → reject any change to `initial_value`/`verified_value`.
- Unlock is an explicit action; any `is_lending_team()` member may unlock; audit logs
  who/when (confirmed decision #2).
- `source='calculated'` fields can't be written by users (only the calc module).
- Summary columns on `loans` (`loan_amount, property_address, borrower_name`, +D3)
  kept in sync from `loan_field_values` by trigger.
- RLS: `lender_only`/trade fields → lending team only; others → `has_loan_access()`.

**Current value resolution:** `verified_value` if present else `initial_value`.
Expose as `loan_field_current(loan_id)` (function or view) — the thing templates,
the Sheet, and the UI read.

**Migration:** copy `custom_fields` scalars → `loan_field_values.initial_value`;
fold `loan_trade.values` → `loan_field_values` (lender-only) per D1.

---

## C. Phased roadmap (weaves into tasks.md P0–P13)

Prior phases through **P8 (Quote & Term Sheet)** are built (M1–M4b). The following
extend the plan. **P14–P16 are the single-source-of-truth foundation; everything
after depends on them.**

### P14 — Field model & single source of truth  *(brief §1, §2)*
- Migration: extend `field_definitions`; create `loan_field_values` + triggers
  (lock, calc read-only, summary-sync) + RLS; `loan_field_current`.
- Seed `field_definitions` from the Field Dictionary tab (script, idempotent).
- Migrate `custom_fields` + `loan_trade.values` into `loan_field_values`; retire
  `loan_trade` (D1).
- Repoint `saveLoanField`, the Loan Data UI (sections incl. `contact`), quote panel,
  term-sheet route, and intake to read `loan_field_current` / write
  `loan_field_values` (initial vs verified; lock/unlock controls for the lending
  team). Rename code keys per Conflict A1.

### P15 — Deal history  *(brief §3)*
- Every `loan_field_values` write inserts `audit_events`: `event_type` ∈
  `field_updated | field_verified | field_locked | field_unlocked`; `payload`
  `{field_key, idx, value_kind, old, new, via: chat|ui|sheet}`.
- "Deal history" timeline on the loan. Chat agent announces its writes
  ("Updated loan amount (initial) to $160,000").

### P16 — Calculations in code  *(brief §4)*
- One calc module per program, keyed by `calc_key`; formulas from the dictionary's
  Formula column. **DSCR:** monthly taxes/insurance/HOA, P&I (amortizing + IO), PITI,
  DSCR, LTV, origination $, cash out, reserves, prepaid interest, net wire, data-tape
  calcs (current_upb, cltv, fixed_period_months, foreign_national_flag, seller_program).
  **RTL:** initial loan amount, budget financed, total loan amount, LTC initial/total,
  ARLTV, initial & fully-disbursed payments, closing_costs (= origination $ +
  underwriting_fee + legal_fee), term_sheet_expiration (+7 days), experience tier
  (T1 0-1, T2 2-9, T3 10+). **Both:** first_payment_date (1st of 2nd month after
  closing). Reuse `program_pricing.model.engine` where it already computes these
  (Conflict A6). Recompute on any input change; store read-only in `loan_field_values`.

### P17 — Intake refresh  *(brief §5)*
- Set `program_ai_config.quote_fields` to dictionary keys — All-programs base set +
  DSCR adds (monthly_rent, annual_taxes, annual_insurance, annual_hoa) + RTL adds
  (purchase_price, rehab_budget, arv, experience_property_count). Keep config-driven
  for later website-intake sync. Intake writes `initial_value`. Multifamily → DSCR.

### P18 — Checklists per loan  *(brief §6)*
- Extend `doc_status`: add `ordered`, `not_applicable` (Conflict A4).
- New `loan_checklist_items` (loan_id, document_type_id, status, notes, updated_by,
  updated_at), created from `program_checklist_items` when a loan reaches
  `processing`. Seed DSCR items from the Checklists tab (RTL list to confirm).
  Status changes log to `audit_events`. "Cleared" = `approved`.

### P19 — Company config in `app_settings`  *(brief §7)*
- Keys: `lender` (name/address/signer/signer_title), `collateral_ship_to`
  (Stride Bank N.A., Attn: Non-QM Collateral, 4700 Gaillardia Pkwy, Suite 200,
  Oklahoma City, OK 73142), `servicers` (name→address/phone/website), `note_buyers`
  (investor→assignee legal name/address). `note_buyer_entity`/`note_buyer_address`
  default from the loan's `investor_name`, overridable per loan. Templates read these
  alongside loan fields.

### P20 — Template fill engine  *(brief §9)*
- `{{key}}` = current value; `{{key_initial}}` / `{{key_verified}}`; `{{key_2}}` for
  repeat index (idx 1 omits suffix). `#hashtag` = alias only. Each template declares
  program, stage, branding (`sphinx | white_label`; white label only swaps
  `white_label_lender_name`), and `requires_verified`. A verified-only template
  (commitment letters) refuses to generate and lists missing/unverified fields.
  **Tab-level generation:** DSCR LOI (LOI / Process Overview / Underwriting Checklist
  tabs) and the RTL letters (Sphinx/White-Label LOI & Commitment tabs of
  `Loan Dashboard - RTL`) each generate on their own as well as whole. Output to the
  loan's Drive folder as `<Doc Type> - <Street Address>`; log `document_generated`.
  Pull fresh templates (Template Fixes tab is done). Retire the Multifamily LOI.
- **Templates in scope (v1):** DSCR LOI, DSCR Commitment Letter, RTL LOI (Sphinx +
  White Label), RTL Commitment Letter (Sphinx + White Label), First Payment Letter,
  Assignment & Allonge, ACH Form, Data Tape. Tag lists per template on the Template
  Map tab. (Note: the existing term-sheet PDF route (P8/M4b) is superseded by this
  engine's DSCR LOI once P14/P16 land — migrate it to `{{key}}` + `loan_field_current`.)

### P21 — Data tape export  *(brief §9)*
- Downloadable `.xlsx`/`.csv`, **one row per property**, exact headers/order from the
  Data Tape Map tab (61 columns). Blank fields export blank — never `0`, `1/0/1900`,
  or a formula error. Calc columns (current_upb, cltv, fixed_period_months,
  foreign_national_flag, seller_program) come from P16.

### P22 — Google Sheet mirror (two-way, with limits)  *(brief §8)*
- One Sheet per loan in its Drive folder; store `sheet_id` on `loans`.
- Row-per-field layout (key, label, initial, verified, locked, updated_by,
  updated_at), grouped by section; repeat groups as extra columns/blocks. **Lookups
  by the key column, never cell addresses.**
- Supabase → Sheet: push the row on every `loan_field_values` change (edge
  function / webhook).
- Sheet → Supabase: Apps Script `onEdit` posts
  `{sheet_id, key, idx, value_kind, value, editor_email}` to an edge function that
  maps editor→profile, validates type, applies lock rules, writes, logs to
  `audit_events`, and reverts the cell with a note on rejection.
- Locked and calculated fields are protected ranges. A History tab mirrors
  `audit_events`.

---

## D. Confirmed decisions (from the brief) — do not re-litigate
1. `{{key}}` is primary; `#hashtag` is a backward-compatible alias only.
2. Any lending-team member can unlock a verified field; every unlock is logged.
3. Loan numbers stay assigned at record creation (current behavior — keep).
4. Checklist uses `approved` only; no separate `cleared` status.
5. Multifamily LOI is retired; Multifamily deals use the DSCR LOI.
6. The fee is `underwriting_fee` everywhere ("Underwriting Fee"); varies by deal.
7. `reserve_months` (PITI at closing) varies by deal; LOI Exhibit B liquidity
   requirement is always 6 months (static text).
8. White label swaps the lender **name only** — no logo/contact block.
9. RTL experience tiers: T1 0-1, T2 2-9, T3 10+. Term sheet expires 7 days after
   issue. `closing_costs` = actual total of the fee fields.
