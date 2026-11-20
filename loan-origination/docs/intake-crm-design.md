# Intake → Opportunity → GoHighLevel: design

**Status:** Draft for build. Field dictionary already updated in the Program Config sheet (see "New dictionary fields" below); no app code written yet.

**Goal:** one native intake form (public + manual) that creates an Opportunity in the platform *and* a Contact + Opportunity in GoHighLevel on submit — killing double entry and the lag that lets deals fall through the cracks.

---

## 1. Why we're doing this

Two pains, in the user's words:

1. **Double entry.** A deal is typed into an intake form, then re-keyed into the platform, then (separately) into the CRM.
2. **Deals falling through the cracks** because a submission doesn't reach the pipeline / review process fast enough — it waits on a human to re-enter it.

Target: **one smooth intake form for everyone regardless of deal type**, that feeds the pipeline and the CRM instantly.

## 2. Current state (what exists today)

There are **two different intake forms live right now** — itself part of the fragmentation:

| Form | URL | Notes |
|---|---|---|
| JotForm (legacy) | https://form.jotform.com/SphinxCapital/intakeform | Single long page. The comprehensive field set. Per-originator and white-label variants are separate JotForm links. |
| Website wizard | https://www.sphinxcap.com/apply | Newer 5-step wizard (Contact → Property → Transaction → Borrower → Review). Adds a **"How did you hear about us?"** question and a **"Fill this out with your AI agent"** affordance. |

Inside the platform (this repo), the relevant machinery **already exists**:

- **Opportunities are native.** Every new deal gets an `OPP####` number from the DB at creation (stage `intake`), becoming `SPHX####` only when it funds. Stage `intake` rolls up into the **"Opportunity"** funnel bucket. See `src/lib/stages.ts`.
- **One end-to-end creator:** `openDeal()` in `src/lib/loans/open-deal.ts` creates the loan row + OPP#, the Drive folder + dashboard, the org tracker row, and the document checklist. Called from the in-app "New loan" button and the `/api/admin/create-loan` ops endpoint. **This is the single seam** both the public form and manual entry hang off, and where the GHL push attaches.
- **Config-driven field dictionary.** `field_definitions` in the app DB is imported from the **Program Config** Google Sheet, "Loan Data" tab (`src/lib/program-config/`). The form, the loan record, and the Deal Dashboard all read from this one dictionary.
- **Integrations behind interfaces:** `src/lib/integrations/types.ts` — the clean place to add a CRM provider.

**Net-new:** there is **no GoHighLevel code** anywhere, and **no public/unauthenticated route** — everything today sits behind lender/admin login. The public, white-label, per-originator form is the biggest new piece.

## 3. Decisions (confirmed)

| Decision | Choice |
|---|---|
| Who renders the form + creates GHL records | **Native form in the platform**, pushing Contact + Opportunity to GHL via API. We own the form, URLs, and white-labeling. |
| Sync direction | **One-way app → GHL** for v1. Platform is the source of truth; new records + stage changes push into GHL. |
| Form shape | **One universal core + conditional blocks** by deal type. Same form for everyone; product-specific fields appear only when relevant. |
| GHL API access | **Available** (credentials + Location ID in hand). Phase 2 will read the live GHL pipeline + custom fields to map exactly. |
| AI chat intake | **Retire for now.** The native form becomes the single intake surface; a future AI intake is rebuilt *on top of* the form (an agent that drives/fills it), not as a separate conversational path. |

### 3.1 Retiring the AI chat intake

The current in-app conversational intake is being dropped so there's one intake surface to build on. Scope of the retire (Phase 1 cleanup):

- **Remove:** the new-deal AI intake flow — `src/lib/ai/intake.ts`, the intake form card (`src/components/intake-form-card.tsx`), the intake path through `floating-chat.tsx` / `chat.tsx`, and the related actions in `src/app/actions.ts`.
- **Decide per-surface:** the admin intake config (`src/app/admin/intake/page.tsx`, `global-intake-editor.tsx`, per-program quote fields) defined the chat's questions. The native form instead reads the **field dictionary** directly, so this config is likely superseded — confirm nothing else depends on it before removing.
- **Careful:** `chat.tsx` / `floating-chat.tsx` may also power **general per-loan chat** (distinct from intake). The removal must separate intake from any loan chat that shares these components, so loan chat keeps working.
- **Future:** AI intake returns as a layer *over* the form (cf. the website's "Fill this out with your AI agent"), reusing the same dictionary + `openDeal`.

## 4. Target architecture: one path, three front doors

All three entry points converge on `openDeal()`, so there is exactly one definition of "a new opportunity":

```
[Public white-label form]  ┐
[Public branded form]      ├──→  openDeal()  ──→  CRM push (GHL)
[Manual entry in-platform] ┘      │                 │
                                  ↓                 ↓
                         Loan @ stage "intake"   GHL Contact (upsert)
                         = Opportunity (OPP#)    + GHL Opportunity
                         + Drive + checklist     (ghl ids saved on loan)
                         + notify owner          + stage pushed on changes
```

## 5. Field mapping

The universal form captures the dictionary fields below. **Existing** = already in the Loan Data tab; **NEW** = added to the sheet as part of this work (section 6). File uploads and consent are handled outside the dictionary (section 7).

### Contact
| Form field | Dictionary key | Status |
|---|---|---|
| Borrower's name (first / last) | `guarantor_first_name` / `guarantor_last_name` | existing |
| Borrower's email | `borrower_email` | existing |
| Borrower's phone | `borrower_phone` | existing |
| Broker / referral partner name | `broker_name` | existing |
| Broker / referral partner email | `broker_email` | **NEW** |
| Broker / referral partner phone | `broker_phone` | **NEW** |
| How did you hear about us? | `heard_about_us` | **NEW** (requested) |
| (operational) how the deal came in | `source_channel` | existing — set from the originator link, not asked of the applicant |

### Property
| Form field | Dictionary key | Status |
|---|---|---|
| Address (street / city / state / zip) | `property_street` / `property_city` / `property_state` / `property_zip` | existing (street line 2 folded into street) |
| Property type | `property_type` | existing — **options expanded** to cover 2-4 Unit, Rental Portfolio, Infill Lot, Land, Office, Retail, Hospitality, Industrial, Medical, Agricultural, Special Purpose |

### Transaction
| Form field | Dictionary key | Status |
|---|---|---|
| Purchase or refinance | `loan_purpose` (Purchase / Refinance - Rate and Term / Refinance - Cash Out) | existing |
| Short- or long-term | `term_preference` | **NEW** (drives product — see §5.1) |
| Renovation / construction / none | `rehab_type` | **NEW** (drives product) |
| Seeking cash out? (Yes/No) | → folds into `loan_purpose` = "Refinance - Cash Out" | existing |

### Purchase-specific (shown when Purchase)
| Form field | Dictionary key | Status |
|---|---|---|
| Purchase price | `purchase_price` | existing |
| Contracted closing date | `closing_date` (target at intake) | existing |

### Refinance-specific (shown when Refinance)
| Form field | Dictionary key | Status |
|---|---|---|
| Original purchase date | `original_purchase_date` | **NEW** |
| Original purchase price | `original_purchase_price` | existing |
| Current value | `as_is_value` | existing |
| Spent on improvements since purchase | `improvements_since_purchase` | **NEW** |
| Current amount owed | `payoff_amount` | existing |

### Project-specific (shown when renovation/construction)
| Form field | Dictionary key | Status |
|---|---|---|
| Total budget | `rehab_budget` | existing |
| Months to complete | `project_months` | **NEW** |
| Expected completed value | `arv` | existing |
| Exit strategy (Sale / Refinance) | `exit_strategy` | **NEW** |

### Rental-specific (shown when long-term)
| Form field | Dictionary key | Status |
|---|---|---|
| Monthly income | `monthly_rent` | existing |
| Annual taxes | `annual_taxes` | existing |
| Annual insurance | `annual_insurance` | existing |
| Annual HOA | `annual_hoa` | existing |

### Borrower
| Form field | Dictionary key | Status |
|---|---|---|
| Borrowing entity name | `borrower_entity` | existing |
| Total liquid assets (all members) | `liquid_assets` | **NEW** |
| Investment properties owned (all members) | `properties_owned_count` | **NEW** |
| Properties sold in past 3 years | `experience_property_count` | existing |
| Combined net worth (all members) | `net_worth` | **NEW** |
| Guarantor credit score | `guarantor_fico` | existing |
| Real estate experience summary | `experience_summary` | **NEW** |
| Anything unique/additional to know | `loan_request_summary` | existing |

### 5.1 Loan-type derivation (how one form serves every product)

The product is **derived** from a few universal answers, not asked directly — so the form stays identical for everyone:

| `term_preference` | `rehab_type` | property class | → Program |
|---|---|---|---|
| Short-term | None | residential | Bridge |
| Short-term | Renovation | residential | Fix & Flip |
| Short-term | Construction | residential | New Construction |
| Long-term | — | residential | DSCR |
| Short-term | None | commercial | Commercial Bridge |
| Short-term | Construction | commercial | Commercial New Construction |
| Long-term | — | commercial | Commercial Permanent |

(Residential vs commercial is read from `property_type`.) This sets `loan_program` / the program at `openDeal` time, which drives the right checklist and conditional fields.

## 6. New dictionary fields (done)

Added to the Program Config sheet → **Loan Data** tab (rows 124–136), all `Source = intake`, `Stage = intake` unless noted:

- `heard_about_us` — *How did you hear about us?* (select: Searched online · An AI assistant · Someone at Sphinx Capital · A broker partner or friend · Other) — all programs
- `broker_email`, `broker_phone` — text — all programs
- `term_preference` — select (Short-term (12-36 months) · Long-term (30-year)) — all programs
- `rehab_type` — select (Construction · Renovation · None) — RTL/construction programs
- `original_purchase_date` — date (Stage: processing) — all programs
- `improvements_since_purchase` — currency — all programs
- `project_months` — number — RTL/construction programs
- `exit_strategy` — select (Sale · Refinance) — RTL/construction programs
- `liquid_assets`, `net_worth` — currency — all programs
- `properties_owned_count` — number — all programs
- `experience_summary` — text — all programs

Also **expanded** `property_type` options (row 51) to the full residential + commercial + land set.

> These live in the sheet now. They appear in the app only after the Program Config is **re-imported** (Settings → Program config), which writes them into `field_definitions`. That re-import is a required step before the form can render them.

## 7. Out-of-dictionary intake pieces

- **Document uploads** on the form → stored per-loan in the existing checklist / `loan_documents`, not as dictionary fields. (The form's "upload anything relevant" maps to the loan's document checklist after the deal is opened.)
- **Consent** ("I agree the information is true… I authorize Sphinx Capital to contact me") → captured as **submission metadata** (boolean + timestamp + IP) on the submission record, not a dictionary field. Required to submit.

## 7.1 Intake Form Data — the read-only snapshot

Every value submitted on the intake form is preserved as a **fixed, read-only snapshot**, shown in its own **"Intake Form Data"** section for reference. It never changes — even as the editable working copies of those same fields are updated through the loan's life. That duplication (snapshot value vs. live value) is intended.

**This already half-exists.** The app carries an **initial-vs-verified** value model: each `loan_field_values` row stores an `initial` and a `verified` value, and there is already a read-only **"Initial Property Data"** card (`src/components/loan-data.tsx`) showing the original intake values for the property fields. We extend and rename it:

- **Rename** "Initial Property Data" → **"Intake Form Data"** and **broaden** it from property-only to the **full set of fields the intake form submits**, rendered read-only.
- **Back it with an immutable submission record** so it is truly fixed: store the exact form payload once at submit (an `intake_submissions` row, or `loans.custom_fields.intake_snapshot`), and render the snapshot card from **that payload** — using the dictionary only for labels/formatting. The live `loan_field_values` are *seeded* from the same payload but then evolve independently (editable in their normal sections). The separate frozen record is what lets the snapshot stay fixed while a duplicate copy is edited elsewhere — the explicit requirement.
  - *Alternative considered:* treat the existing `initial` value as the snapshot and lock it. That works for verifiable fields (as-is value, purchase price), but non-verifiable intake fields (`liquid_assets`, `net_worth`, `heard_about_us`, …) have only one value lane, so editing the working copy would also move the "snapshot." The immutable record avoids this, and is why we don't rely on the `initial` lane alone.

**Not a sheet change.** "Initial Property Data" / "Intake Form Data" is a **UI card**, not a value in the Loan Data tab's `Section` column — so there's nothing to rename in the sheet. The snapshot's field list is just the keys present in the stored submission payload (the form's own field set), which keeps it correct even for form fields whose dictionary `Source` isn't literally `intake` (e.g. the "anything additional" note → `loan_request_summary`, "contracted closing date" → `closing_date`).

- **Visibility (open):** the current Initial Property Data card is lender-only; default the Intake Form Data snapshot to the same, unless we want applicants to see their own submission back.

## 8. Public form, white-label & originator links (Phase 3)

- New **unauthenticated** route (e.g. `/apply/[token]`), outside the login wall.
- `intake_links` table: `token`, `originator_id`, `branding` (`sphinx` | `white_label`), optional `custom_domain`, `active`. Each originator gets one or more links; the white-label link renders **no Sphinx branding** and sets `source_channel` + originator automatically.
- **White-label domain:** branded link on the Sphinx domain; white-label link on a **neutral** domain (DNS/Vercel task) so brokers can forward it without revealing Sphinx. *(Open: do we already own a neutral domain?)*
- **Spam protection:** honeypot + CAPTCHA for real submitters, rate limiting. (Note: automated testing can't solve CAPTCHAs; real users will.)
- Submit → server action → `openDeal({ source: 'intake_form', originatorId, branding })`.

## 9. GoHighLevel sync (Phase 2)

- New `CrmProvider` interface + a GoHighLevel implementation (LeadConnector v2 API), behind `src/lib/integrations`.
- On `openDeal`: **upsert Contact** (dedupe rule TBD — email, phone, or both), **create Opportunity** in a chosen GHL pipeline + stage, set the **owner** from the originator, tag the **source**. Store `ghl_contact_id` / `ghl_opportunity_id` on the loan.
- On **stage change**, PATCH the GHL opportunity so the funnel and GHL pipeline stay aligned (one-way).
- **Resilient:** create the deal first, push to GHL after with retry — GHL being down must never block a deal from entering the pipeline.
- **Mapping (Phase 2, from live GHL):** which pipeline new opportunities land in, how our stage buckets map to GHL stages, and which GHL **custom fields** receive loan data beyond name/email/phone. Pull these from the GHL API when building.

## 10. Notifications

On each new submission, notify the right originator/processor (in-app + email/Slack) so a fresh Opportunity gets eyes immediately — the direct fix for "falling through the cracks."

**Scoping:** built in **Phase 3**, with the public form. For Phase 1 manual entry the creator is present and the deal lands in the pipeline instantly, so there's no one to alert; the gap only appears when external (broker/public) submissions arrive unattended. There is no email/Slack/in-app-alert infrastructure in the app today, so Phase 3 introduces it rather than Phase 1 guessing at it.

## 11. Phasing

| Phase | Delivers | Kills |
|---|---|---|
| **1. Unified native form** | Universal + conditional form, used for manual entry; opens an Opportunity instantly (derives the program), stores the immutable **Intake Form Data** snapshot (§7.1) and renders it read-only. **Retires the AI chat intake** (§3.1). Notifications move to Phase 3 (§10). | Internal double entry + latency |
| **2. GHL sync** | `CrmProvider` → create contact/opportunity on `openDeal`, store ids, push stage changes | Double entry into GHL |
| **3. Public links + white-label** | Per-originator tokens, white-label domain, spam protection | Brokers submit directly; no re-keying |

## 12. Open items

- Dedup rule for GHL contacts: email, phone, or both?
- Neutral domain for the white-label form — own one already?
- GHL pipeline + stage mapping + custom-field inventory (resolve against live GHL in Phase 2).
- Consolidate / retire the two existing forms (JotForm + website wizard) once the native form is live — decide whether the website `/apply` embeds the native form or redirects to it.
- AI intake: the in-app AI chat intake is **retired now** (§3.1); the AI-driven intake is rebuilt on top of the form later. Confirm the admin intake config has no other dependents before removing it.

## 13. Next steps

1. **Re-import Program Config** (Settings → Program config) so the 13 new fields + expanded `property_type` land in `field_definitions`. *(required before the form can render them)*
2. Build **Phase 1** — the unified native form rendering from the dictionary, wired to `openDeal`, with submission + notification.
3. Then Phase 2 (GHL) and Phase 3 (public/white-label).
