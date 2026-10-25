# Tasks — Chat-Driven Private Loan Origination System (Prototype)

**Status:** Draft for review · **Date:** 2026-10-25 · **Method:** Spec-Driven Development (Phase 3 of 3)
**Traces:** [requirements.md](requirements.md) rev 5 · [design.md](design.md) rev 2. Each task cites the requirement (`R-*`) and design (`§`) it fulfills.

---

## How to read this plan

- Tasks are grouped into **phases (P0–P12)** in roughly dependency order. Within a phase, tasks can often proceed in parallel.
- Each task has an **ID**, **dependencies**, **references**, and an **acceptance check** (how we know it's done).
- **Prototype discipline:** build the deterministic flow first, layer AI on top; mock external providers behind interfaces (R-NFR-6/8). Nothing auto-sends or auto-advances.
- **Critical path:** P0 → P1 → P2 → P3 → P4 → P6 (intake) → P8 (quote/term) → P9 (processing) → P10 (UW/close). Drive (P7) and Gmail (P11) can develop in parallel once the integration layer (P0-4) exists.

---

## P0 — Foundations

- **T0.1 — Repo & app scaffold.** Next.js (TypeScript) + Tailwind; folder structure for app, server actions, lib, integration interfaces. _Deps: —. Ref: design §2. Accept: app boots, lints, type-checks._
- **T0.2 — Supabase project & local dev.** Provision Supabase (DB, Auth, Realtime, Storage); wire env/secrets; local CLI + migrations workflow. _Deps: T0.1. Ref: §2. Accept: app connects; a trivial migration applies._
- **T0.3 — Integration interface stubs.** Define TypeScript interfaces `DocumentStore`, `MailService`, `PricingProvider`, `ESignProvider`, `PipelineProvider`, `CreditProvider`, each with a mock impl. _Deps: T0.1. Ref: §3, §8.3, R-NFR-6. Accept: mocks injected via a provider registry; swappable by config._
- **T0.4 — Anthropic client + model routing.** Server-side Claude client; config for fast model (chat) vs `claude-opus-4-8` (review/underwriting). _Deps: T0.1. Ref: §6. Accept: a test prompt returns a streamed response server-side._
- **T0.5 — App shell layout.** Three-region deal layout (top bar, center, right sidebar) + lender left sidebar, responsive. _Deps: T0.1. Ref: §12, R-UI-1/2/7/8. Accept: empty shell renders at desktop and mobile widths._

## P1 — Auth, roles & access

- **T1.1 — Auth flows.** Magic-link, email/password, Google OAuth via Supabase Auth; login page with email-entry → magic link. _Deps: T0.2. Ref: §11, R-AUTH-2/3/4. Accept: sign in all three ways._
- **T1.2 — Role claims.** Put `is_lending_team` + `lender_user_type` into the JWT; server helper to resolve caller identity/role. _Deps: T1.1. Ref: §5, §11. Accept: a server action reads correct role from token._
- **T1.3 — User-scoped DB client.** Request-time Postgres client that carries the caller's JWT so **RLS applies**; the `service_role` client is isolated to background jobs only. _Deps: T1.2. Ref: §5.1 (hard rule). Accept: a borrower-token query cannot read another loan; service client is import-guarded out of request paths._
- **T1.4 — Landing routing.** Lending-team users land on the **Pipeline home** (T12.1); borrowers/originators with >1 loan see the **loan picker**, else open their single deal. _Deps: T1.3, T2.1. Ref: R-AUTH-7, R-UI-8/10. Accept: lender lands on pipeline; multi-loan borrower sees picker; single-loan borrower goes straight in._

## P2 — Data model & RLS

- **T2.1 — Core schema migration.** `users`, `deal_participants`, `loans`, `loan_number_seq`, `borrowers`, `borrower_identities`, `guarantors`, `properties`, `custom_fields` columns, `trade_data`, `field_tags`. _Deps: T0.2. Ref: §4.1/4.2/4.7, R-DATA-*. Accept: migration applies; FKs and constraints hold._
- **T2.2 — Programs & library schema.** `loan_programs`, `document_types`, `program_checklist_items`, `program_tasks`, `email_templates`, `automated_email_config`. _Deps: T0.2. Ref: §4.3, §13. Accept: migration applies._
- **T2.3 — Conversation, docs, decisions schema.** `messages`, `audit_events`, `documents` (unified), `checklist_items`, `tasks`, `quotes`, `signatures`, `underwriting_decisions`, `conditions`, `approvals`, `internal_notes`, `crm_contacts`. _Deps: T0.2. Ref: §4.4/4.5/4.6. Accept: migration applies._
- **T2.4 — RLS policies.** Policies on every table keyed on JWT role + `deal_participants` membership; borrowers/originators blocked from `internal_notes`, `trade_data`, lender-only tasks, and internal program fields; public program tier readable. _Deps: T2.1–2.3, T1.2. Ref: §5, §5.2, R-AUTH-1, R-NOTES-2, R-TASK-2. Accept: policy test suite — each role sees exactly its allowed rows._
- **T2.5 — Loan-number sequence.** Transactional allocator starting SPHX500, no reuse. _Deps: T2.1. Ref: R-DRIVE-1. Accept: concurrent allocation yields unique, gapless-start, never-reused numbers._
- **T2.6 — Audit event writer.** Central helper that every state change calls (actor, kind, type, payload, ts). _Deps: T2.3. Ref: §4.4, R-AUDIT-1/2. Accept: a sample mutation produces an attributed event._

## P3 — Shared conversation & real-time

- **T3.1 — Messages API + send.** Create/list messages with attribution, role label, `is_internal` flag. _Deps: T2.3, T1.3. Ref: R-CHAT-1/3/4/5, R-NOTES-1. Accept: messages persist with correct attribution; internal hidden from borrower queries (via RLS)._
- **T3.2 — Realtime subscription.** Client subscribes to the loan channel; new messages/record changes stream in. _Deps: T3.1. Ref: R-NFR-9. Accept: two browsers see each other's messages near-instantly._
- **T3.3 — System/AI event messages.** Render stage changes, field updates, doc receipts, emails-sent as attributed system messages. _Deps: T3.1, T2.6. Ref: R-CHAT-7. Accept: a stage change posts a system message._
- **T3.4 — Current-stage banner.** Post current stage on open unless it was the last message. _Deps: T3.1, T5.1. Ref: R-STAGE-5. Accept: re-opening doesn't duplicate the banner._

## P4 — AI record-keeper agent

- **T4.1 — Agent service + scoped retrieval.** Per-request agent built from role-scoped queries (uses T1.3 client); context assembly intersects current loan ∩ user's accessible loans. _Deps: T1.3, T2.4, T0.4. Ref: §5, §5.1, §6. Accept: borrower-scoped agent cannot retrieve internal notes/trade/other loans._
- **T4.2 — Tool framework.** Register tools; each write re-authorizes server-side and logs an audit event. _Deps: T4.1, T2.6. Ref: §6, §5.1. Accept: a tool write by an under-privileged role is rejected._
- **T4.3 — Read tools.** `get_loan_record`, `get_program_info` (borrower-safe tier only for external roles). _Deps: T4.2, T2.4. Ref: §5.2, §6. Accept: borrower gets public program info, not pricing/review config._
- **T4.4 — Write tool.** `update_loan_fields` honoring field edit permissions. _Deps: T4.2, T13.x fields. Ref: R-ADMIN-15, R-DATA-8. Accept: borrower can edit own contact/mailing, not loan terms._
- **T4.5 — Untrusted-content guard.** Uploaded text/transcripts passed as data, not instructions; injection test. _Deps: T4.1. Ref: §5.1. Accept: an uploaded "ignore rules" document does not alter behavior or leak data._

## P5 — Admin backend: Library + Programs

- **T5.0 — Admin shell & gating.** Admin area reachable only by Admin users; Settings vs Programs navigation (§13 tree). _Deps: T1.2, T2.2. Ref: R-ADMIN-1, R-AUTH-8. Accept: non-admins blocked._
- **T5.1 — Library: Document Types.** CRUD catalog with default naming + optional review rules. _Deps: T5.0. Ref: §13, R-ADMIN-8/9. Accept: a type defined once is reusable._
- **T5.2 — Library: Loan Fields & Tags.** Field dictionary, `#hashtag` registry (scalar + indexed/collection), edit-permission masks. _Deps: T5.0, T2.1. Ref: §9, R-TAG-1, R-ADMIN-15. Accept: tags unique; collection tags supported; validation catches dup/unknown._
- **T5.3 — Library: Email Templates + automation config.** Templates + which events auto-draft. _Deps: T5.0. Ref: R-ADMIN-14. Accept: templates render with sample data._
- **T5.4 — Library: Document Templates.** Register/map templates from the Drive templates folder. _Deps: T5.0, T7.4. Ref: R-ADMIN-11, R-DRIVE-6. Accept: templates list from Drive._
- **T5.5 — Program editor (7 tabs).** Overview (loan-type→program map), Intake Flow, Pre-Qual, Pricing, Documents (reference library + overrides), Tasks, Templates. _Deps: T5.1–5.4. Ref: §13, R-ADMIN-5/6/7/10/11/12/13, R-INTAKE-11. Accept: a full program (e.g., DSCR) is configurable end-to-end._
- **T5.6 — Override model.** `effective = override ?? library default`, with inherited-value UI affordance. _Deps: T5.5. Ref: §13. Accept: overriding a doc type's naming affects only that program._
- **T5.7 — Users & Roles + AM intake links.** Manage Admin/Operations/Account Manager; generate per-AM personal intake links. _Deps: T5.0. Ref: R-ADMIN-2, R-ADMIN-4a. Accept: AM link carries assignment._
- **T5.8 — Seed defaults.** Seed the six programs, common document types, core fields/tags, baseline email templates. _Deps: T5.1–5.5. Ref: decision #1, §13. Accept: fresh install is demo-ready._

## P6 — Intake

- **T6.1 — Stage machine (skeleton).** Deterministic `loans.stage` machine; readiness checks; Admin-approval-gated transitions; branch states. _Deps: T2.1, T2.6. Ref: §7, R-STAGE-1/2/3/4/6/7. Accept: transitions only via Admin approval; events logged._
- **T6.2 — Conversational intake flow.** AI-guided Who/What/Where/When/Why driven by the program's conditional intake form; self-identify borrower vs originator; gather borrower (+borrower if originator). _Deps: T4.x, T5.5. Ref: R-INTAKE-1..5, R-INTAKE-12. Accept: configured flow runs; branches honored._
- **T6.3 — Multi-modal capture + extraction.** Typed/audio-upload/live-voice/document input → field extraction → confirm-back. _Deps: T6.2. Ref: R-INTAKE-6, R-NFR (voice). Accept: fields extracted and confirmed before write._
- **T6.4 — Borrower type & multi-party/property.** Individual vs entity (corp/LLC/trust) selection; multiple borrowers, guarantors (individuals), properties. _Deps: T6.2, T2.1. Ref: R-INTAKE-12/13, R-DATA-5/6/7. Accept: entity + 2 properties + 2 guarantors captured._
- **T6.5 — Submit: number + folder + assignment.** On submit, allocate loan number, create Drive folder, assign Account Manager (link or Admin), map loan type → program. _Deps: T2.5, T7.1, T5.7. Ref: R-INTAKE-8/11/14, R-DRIVE-2. Accept: deal created with number, folder, program, AM._
- **T6.6 — Intake email.** Draft the data-summary + 24h thank-you email (per-message approval). _Deps: T6.5, T11.1. Ref: R-INTAKE-9, R-MAIL-4. Accept: draft queued for approval, logged on send._
- **T6.7 — CRM auto-save.** New/applied borrower saved to the AM's CRM. _Deps: T6.5, T12.2. Ref: R-ADMIN-4. Accept: borrower appears in AM's CRM._

## P7 — Google Drive integration (`DocumentStore`)

- **T7.1 — Drive auth + folder creation.** OAuth to lending-team Google account; create `Open Loan Files/{Number} {Address} {Borrower}` with standard subfolders. _Deps: T0.3. Ref: §8.1, R-DRIVE-2/8. Accept: folder appears with subfolders._
- **T7.2 — Upload mirroring + relabel.** Store bytes in Supabase Storage (primary) → mirror to correct Drive subfolder with program naming convention. _Deps: T7.1, T9.2. Ref: R-DRIVE-3, R-PROC-5. Accept: uploaded doc appears in both, correctly named._
- **T7.3 — Two-way delete + reconciliation.** Confirm-before-delete; soft-delete locally; delete in Drive; Drive-change watch + scheduled reconciliation for Drive-side deletions. _Deps: T7.2. Ref: R-DRIVE-4/5. Accept: delete in platform removes from Drive and vice-versa; confirm dialog required._
- **T7.4 — Templates folder access.** Read the Drive templates folder for the Library. _Deps: T7.1. Ref: R-DRIVE-6. Accept: templates enumerated._
- **T7.5 — Failure handling.** Failed Drive ops surface in chat and block dependent step completion. _Deps: T7.2. Ref: R-DRIVE-7. Accept: simulated failure leaves item not-complete with a chat notice._

## P8 — Quote & Term Sheet

- **T8.1 — Pricing provider.** `PricingProvider`: program pricing **model** path and **guidelines** path. _Deps: T0.3, T5.5. Ref: R-QTS-2/3, R-ADMIN-10. Accept: model program auto-prices; guidelines program supports manual._
- **T8.2 — Template fill engine.** docx token fill (`docxtemplater`) + PDF AcroForm pre-fill; collection/indexed tags; validation against registry. _Deps: T5.2, T5.4. Ref: §9, R-TAG-2. Accept: term sheet fills with correct values incl. multiple borrowers; unknown tag blocked._
- **T8.3 — Quote → term sheet.** Generate term sheet from accepted quote; versioning; re-issue supersedes. _Deps: T8.1, T8.2. Ref: R-QTS-1/2/7. Accept: versioned term sheet stored as a `documents` row (generated)._
- **T8.4 — Inline e-sign + auth page.** `ESignProvider` prototype: open/sign inline in chat; capture signer/time/IP/geo; append authentication page; mark Signed; store executed copy in Drive. _Deps: T8.3, T7.2. Ref: R-QTS-4/5/6, §10. Accept: signed doc has auth page; signature row recorded._
- **T8.5 — Other signable docs.** Same flow for authorization forms, LOEs, full application. _Deps: T8.4. Ref: R-QTS-9. Accept: a second template type signs end-to-end._

## P9 — Processing

- **T9.1 — Enter Processing: derive checklist/tasks.** Instantiate checklist items + tasks from the program; first borrower task = full application (fillable PDF). _Deps: T6.1, T5.5, T8.5. Ref: R-PROC-1/2. Accept: checklist + application task created on entry._
- **T9.2 — Upload + document-type prompt.** Chat upload prompts for document type; store + relabel (→ T7.2). _Deps: T3.1, T7.2. Ref: R-PROC-3/4/5/6. Accept: uploaded file is typed, stored, relabeled._
- **T9.3 — Documents pop-out.** Right-sidebar pop-out with Outstanding/Update Needed/Approved + completeness. _Deps: T9.1. Ref: R-UI-4, R-PROC-3/12. Accept: statuses + "X of Y" shown live._
- **T9.4 — AI review (where rules exist).** `review_document` applies program/library review rules → Approved/Update Needed + reason; concurrent with collection. _Deps: T4.2, T9.2. Ref: R-PROC-7/8. Accept: a rule-bearing doc is auto-reviewed with reason._
- **T9.5 — Human review (no rules).** Route rule-less docs to lending team; set status + notes. _Deps: T9.2. Ref: R-PROC-9/10. Accept: rule-less doc awaits human; status settable._
- **T9.6 — Checklist admin on deal.** Add/remove/waive items with reason; gate to Underwriting when all required approved. _Deps: T9.1, T6.1. Ref: R-PROC-11/13. Accept: waiving a required item unblocks readiness with reason logged._
- **T9.7 — Tasks UI + visibility.** Task list with assignee/complete/timestamps; lender tasks hidden from borrower/originator; all visible to team. _Deps: T2.3, T2.4. Ref: §10, R-TASK-1..5. Accept: borrower doesn't see lender tasks._
- **T9.8 — Reminders.** Gmail reminder for outstanding doc/task on request or cadence (draft+approve). _Deps: T11.1. Ref: R-PROC-14, R-TASK-5. Accept: reminder draft generated for an outstanding item._

## P10 — Underwriting, Final Approval, Closing

- **T10.1 — Underwriting summary.** Assemble summary from intake/pre-qual/term sheet/approved docs; present to Admin. _Deps: T9.6. Ref: R-UW-1. Accept: summary renders for a ready deal._
- **T10.2 — Underwriting decision.** Record Approve / Approve-with-conditions / Decline / Counter + rationale; Counter → back to Quote&TS; Decline → Declined + notify. _Deps: T10.1, T6.1. Ref: R-UW-2/3/4/5/6. Accept: each decision path transitions correctly._
- **T10.3 — Conditions tracking.** Capture conditions; track satisfied/unsatisfied. _Deps: T10.2. Ref: R-UW-3, R-APPR-2. Accept: condition toggles update readiness._
- **T10.4 — Final approval + lock.** Admin-only; blocked until conditions satisfied; lock final terms; generate/store approval doc; record approver/ts. _Deps: T10.3. Ref: R-APPR-1/2/3/4. Accept: unsatisfied condition blocks; approval locks terms._
- **T10.5 — Closing workflow.** Generate closing docs from templates; fill/sign/download; closing task checklist; block funding until complete. _Deps: T8.2, T8.4, T9.3. Ref: R-CLOSE-1/2. Accept: closing checklist + downloadable docs; funding gated._
- **T10.6 — Funding + Post-Close.** Admin confirms funding → Post-Close; lock borrower info for this loan. _Deps: T10.5, T13.3. Ref: R-CLOSE-3, R-POST-5, R-DATA-4. Accept: funded deal moves to Post-Close; borrower fields locked._
- **T10.7 — Post-close servicing.** Keep chat open; capture/track post-close requests; store post-close docs. _Deps: T3.1, T7.2. Ref: R-POST-1/2/3/4. Accept: a post-close request is tracked to resolution._

## P11 — Gmail integration (`MailService`)

- **T11.1 — Draft + per-message approval.** All sends create a Gmail draft; lending-team approves per message; log send. _Deps: T0.3, T5.3. Ref: §8.2, R-MAIL-1/2/3/4/5/6. Accept: nothing sends without approval; every send logged._
- **T11.2 — Event-driven drafts.** Configured lifecycle events auto-draft (queued for approval). _Deps: T11.1, T5.3. Ref: R-MAIL-3, R-ADMIN-14. Accept: term-sheet-signed event drafts the right template._
- **T11.3 — Inbound association (optional).** Best-effort match inbound email to a loan; surface in thread. _Deps: T11.1. Ref: R-MAIL-7. Accept: a matching reply appears in the deal thread._

## P12 — Lender views, internal data, pipeline, hardening

- **T12.1 — Pipeline home + Add Loan.** Lender **landing view**: table of all accessible loans (Address, Loan Number, Borrower, Loan Amount, Loan Type, Stage, expected close) with filter/search; row opens the deal; **Add Loan** button starts a new intake chat. Also reachable from the left sidebar. _Deps: T2.4, T6.2. Ref: R-UI-8/8a/11, R-AUTH-7. Accept: lender lands here on login; only accessible loans shown; Add Loan opens a new intake chat._
- **T12.2 — CRM.** Account Manager CRM tab (own contacts); Admin sees all labeled by owner; Admin can own. _Deps: T2.3, T2.4. Ref: R-ADMIN-3/4/5. Accept: AM sees own; Admin sees all with owner labels._
- **T12.3 — Internal Notes + Trade + AI wall.** Lender-only Internal Notes sidebar; Trade section lender-only; verify AI never surfaces either to borrowers/originators. _Deps: T2.4, T4.1. Ref: §5, R-NOTES-1..4, R-TRADE-1. Accept: borrower-scoped AI cannot retrieve notes/trade (automated test)._
- **T12.4 — Loan Info + People sidebars.** Loan/Property/Borrower/Guarantor/Trade pop-out (Trade lender-only); People with contacts. _Deps: T2.1, T2.4. Ref: R-UI-3/5/6. Accept: sections render; Trade hidden from borrower._
- **T12.5 — Borrower-identity propagation + locks.** Shared borrower info propagates to that identity's non-closed loans; blocked for closed; field permissions enforced. _Deps: T2.7-identity, T10.6. Ref: R-DATA-1/2/3/4/8. Accept: editing borrower info updates open loans only; closed loan unchanged._
- **T12.6 — Mock providers labeled.** Pipeline/credit/KYC mocks return clearly-simulated results. _Deps: T0.3. Ref: R-NFR-8. Accept: UI marks simulated results._
- **T12.7 — History view.** Per-deal audit history, borrower/originator view excludes internal entries. _Deps: T2.6, T2.4. Ref: R-AUDIT-1/2/3. Accept: history renders; internal entries hidden from external roles._

## P13 — Verification & demo

- **T13.1 — Access-control test suite.** Automated tests: each role × each table/field, cross-borrower isolation, AI boundary, service-role-not-in-request-path check. _Deps: P2, P4, P12. Ref: §5, R-NFR-5. Accept: suite green; a deliberate leak attempt fails safely._
- **T13.2 — End-to-end happy path.** Intake → pre-qual → term sheet signed → processing → underwriting → final approval → closing → post-close, on a DSCR deal. _Deps: P6–P11. Ref: all lifecycle. Accept: one deal completes the full flow._
- **T13.3 — Drive/Gmail integration tests.** Mirror, two-way delete + reconciliation, draft-and-approve. _Deps: P7, P11. Ref: §8. Accept: sync + approval behaviors verified._
- **T13.4 — Seed + demo script.** Seeded programs/library/users + a short scripted walkthrough. _Deps: T5.8. Ref: §13. Accept: a fresh environment demos end-to-end._

---

## Suggested milestones (demo-able increments)

1. **M1 — Walking skeleton:** P0 + P1 + P2 + P3 → auth, roles, RLS, a deal with shared real-time chat. _Proves the access model._
2. **M2 — AI + intake:** P4 + P6 (+ P7 folder/upload basics) → start a loan by talking to the AI; deal + number + Drive folder created.
3. **M3 — Admin configurability:** P5 → Library + Programs; the six programs configured.
4. **M4 — Deal flow:** P8 + P9 → quote/term-sheet/e-sign and processing with AI review.
5. **M5 — Decisions & close:** P10 + P11 → underwriting through funding, with Gmail correspondence.
6. **M6 — Polish & prove:** P12 + P13 → lender views, isolation, audit, full E2E + access-control suite.

---

## Open implementation decisions (carry into build)

- Exact Supabase Storage vs. Drive paths and the reconciliation cadence (§8.1).
- docx-vs-PDF authoring convention for each seeded template (§9).
- Voice capture UX (live mic vs. upload) and transcription provider (R-INTAKE-6).
- Coarse geo-IP source for the e-sign auth page (§10, §14).

---

_This completes the Spec-Driven Development set: [requirements.md](requirements.md) · [design.md](design.md) · tasks.md. On approval, implementation can begin at M1 (the walking skeleton), which stands up the access model everything else depends on._
