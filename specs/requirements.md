# Requirements — Chat-Driven Private Loan Origination System (Prototype)

**Status:** Draft for review (rev 7) · **Date:** 2026-10-24 · **Method:** Spec-Driven Development (Phase 1 of 3)

---

## 1. Introduction

This document specifies the requirements for a prototype **chat-driven private loan origination system**. A shared conversation is the central interface through which a **borrower**, their **originator** (external broker / referral partner), and the **lending team** collaborate — and through which an **AI "record keeper & originator"** answers questions and maintains the loan record. The system carries a private loan from first inquiry through post-close servicing.

### 1.1 Scope and integration constraints

- **Live integrations (in scope):** **Google Drive** (document redundancy/backup + e-sign templates, §14) and **Gmail** (notifications, signing acknowledgements, communications — pushed and automated, §13).
- **Out of scope for now (design behind interfaces, do not depend on):** the Sphinx Capital deal-pipeline connector, the Sphinx website application form, credit-bureau/KYC/AML services, payment rails, and external underwriting data providers — represented by **mocked/local** implementations.
- This is a **prototype**: a working, demonstrable end-to-end flow — not a production, fully-compliant, or hardened deployment. Items marked _(prototype simplification)_ note where production would require more.
- **System of record (prototype assumption, see Q-SOT):** the platform's own datastore is the source of truth for loan data and documents; **Google Drive is a synchronized backup** (with two-way deletion, §14).

### 1.2 Document conventions

Acceptance criteria use **EARS**: THE SYSTEM SHALL … · WHEN \<trigger\>, THE SYSTEM SHALL … · WHILE \<state\>, THE SYSTEM SHALL … · IF \<condition\>, THEN THE SYSTEM SHALL … · WHERE \<feature\>, THE SYSTEM SHALL …. Each requirement has a stable ID (`R-<area>-<n>`).

---

## 2. Roles and actors

**Participant roles (per deal):**

| Role | Description |
|------|-------------|
| **Borrower** | The applicant. May be an **individual or an entity** (corporation, LLC, trust); the type is selected at intake. Multiple borrowers may share one deal. |
| **Originator** | An external **broker or referral partner** representing a borrower. Displayed as "Originator" in chat history (never "Broker"). |
| **Guarantor** | An individual guaranteeing the loan. A deal may have **multiple guarantors**, each an individual. |

**Lending-team user types (platform-wide):**

| User type | Permissions |
|-----------|-------------|
| **Admin** | Update all settings; holds **underwriter/approver** authority; approves stage advancement. |
| **Operations** | Everything except Admin settings. |
| **Account Manager** | Everything except Admin settings; additionally has a **CRM** sidebar (§4, §12). _(Internal relationship owner who sources deals.)_ |

| Actor | Description |
|-------|-------------|
| **AI record keeper & originator** | The system's conversational agent per deal: answers loan questions on demand, maintains the record, assists intake and document review, within access boundaries (§16). |

---

## 3. Shared conversation and access

**User story:** As any participant, I want one shared chat with full history and an on-demand AI assistant so that everyone sees the same thread and can get answers and update the record in one place.

- **R-CHAT-1** THE SYSTEM SHALL maintain exactly one shared conversation per deal, visible to assigned participants (subject to §16).
- **R-CHAT-2** THE SYSTEM SHALL persist full chat history per deal and present it chronologically to any assigned participant.
- **R-CHAT-3** WHEN a participant sends a message, THE SYSTEM SHALL attribute it by name and role with a timestamp.
- **R-CHAT-4** THE SYSTEM SHALL label each message with sender role (borrower, originator, lending team, or AI).
- **R-CHAT-5** THE SYSTEM SHALL allow participants to update loan record fields and upload documents directly from the chat (subject to field edit permissions, §12).
- **R-CHAT-6** THE SYSTEM SHALL provide an AI "record keeper & originator" that, on demand, answers questions and provides loan information from the deal record and documents, within access boundaries (§16).
- **R-CHAT-7** THE SYSTEM SHALL record system/AI events (stage changes, field updates, document receipts, reviews, decisions, emails sent) into history as attributed messages.
- **R-CHAT-8** WHEN a deal is opened, THE SYSTEM SHALL display the current stage per R-STAGE-5.

---

## 4. User interface and layout

**User story:** As a participant, I want a chat-centered UI with quick access to people, documents, loan data, and (for the team) pipeline and CRM, so that I can work deals without leaving the conversation.

- **R-UI-1** THE SYSTEM SHALL present the **shared chat as the central feature** of the deal view, supporting messaging, inline record/field updates, document upload, and AI interaction.
- **R-UI-2** THE SYSTEM SHALL present a **right sidebar** with **People**, **Documents**, and **Loan Info**; for the lending team, **Internal Notes** (§16); for **Account Manager** users, a **CRM** tab (§12).
- **R-UI-3** WHEN **People** is selected, THE SYSTEM SHALL show all parties and their contact info.
- **R-UI-4** WHEN **Documents** is selected, THE SYSTEM SHALL open a pop-out of all required documents with status **Outstanding / Update Needed / Approved**.
- **R-UI-5** WHEN **Loan Info** is selected, THE SYSTEM SHALL open a pop-out of all loan data organized into **Loan, Property, Borrower, Guarantor, Trade** sections, supporting multiple borrowers and multiple guarantors.
- **R-UI-6** THE SYSTEM SHALL show the **Trade** section and **Internal Notes** only to lending-team users.
- **R-UI-7** THE SYSTEM SHALL present a **top bar** with a **stage progress bar** (all stages, current indicated) and **Deal Info**: property address, loan type, loan amount, expected closing date.
- **R-UI-8** THE SYSTEM SHALL present a **Pipeline View** to lending-team users listing all loans they have access to, with filter and search, showing at least **Address, Loan Number, Borrower, Loan Amount, Loan Type, Stage** (and expected closing date). This view is both the lender's **home/landing view on login** (shown before entering any loan, R-AUTH-7) and reachable any time from the **left sidebar** (near Settings).
- **R-UI-8a** WHEN a lending-team user selects a loan in the Pipeline View, THE SYSTEM SHALL open that loan's chat/deal view.
- **R-UI-9** THE SYSTEM SHALL make loan data fields editable by Admin (§12) and by other roles only where configuration permits (§12, field edit permissions).
- **R-UI-10** WHERE a borrower or originator has access to more than one deal, THE SYSTEM SHALL present a **loan picker** on login; selecting a loan opens its chat view (§17). _(For lending-team users, the Pipeline View (R-UI-8) serves as this home.)_
- **R-UI-11** THE SYSTEM SHALL present an **"Add Loan" button** on the lender's Pipeline/home view; WHEN clicked, THE SYSTEM SHALL **start a new chat** in which the user sets up a new loan via the intake flow (R-INTAKE-1).

---

## 5. Loan lifecycle and stage gating

**User story:** As the lending team, I want defined stages with gates and explicit admin approval to advance so that work happens in the right order under team control.

Canonical stages:

1. **Intake** → 2. **Pre-Qualification** → 3. **Quote & Term Sheet** (Issued → Signed) → 4. **Processing** (document collection + review, concurrent) → 5. **Underwriting** → 6. **Final Approval** → 7. **Closing** → 8. **Post-Close**

Terminal/branch states: **Declined**, **Withdrawn**, **On Hold**.

- **R-STAGE-1** THE SYSTEM SHALL track a single current stage per deal from the canonical set.
- **R-STAGE-2** WHEN a deal changes stage, THE SYSTEM SHALL record the transition (from, to, actor, timestamp, reason) in history.
- **R-STAGE-3** THE SYSTEM SHALL require **lending-team Admin approval for every stage advancement**; the system SHALL NOT auto-advance.
- **R-STAGE-4** WHEN a deal's gate conditions for the next stage are met, THE SYSTEM SHALL mark it **ready to advance** and SHALL prompt the Admin team directly upon opening the file to approve the advancement.
- **R-STAGE-5** THE SYSTEM SHALL display the current stage (and what's needed to advance) in the Chat UI, **posting it fresh each time the deal is opened — except when the current-stage message was the most recently displayed message**.
- **R-STAGE-6** THE SYSTEM SHALL allow an authorized lending-team member to move a deal to **On Hold / Withdrawn / Declined** from any active stage, with a recorded reason.
- **R-STAGE-7** THE SYSTEM SHALL state the unmet condition when it blocks a readiness check or advancement.

---

## 6. Intake

**User story:** As a borrower, originator, or lending-team member, I want to start a new loan by telling the AI about the deal in a natural conversation, with the fields driven by an admin-configured form flow.

- **R-INTAKE-1** THE SYSTEM SHALL allow a **borrower, originator, or lending-team member** to start a new loan.
- **R-INTAKE-2** THE SYSTEM SHALL drive intake from an **admin-configurable conditional intake form flow** (§12): which fields are gathered, their order, and conditional branches.
- **R-INTAKE-3** WHEN intake begins, THE SYSTEM SHALL ask the submitter to **self-identify as a borrower or an originator (broker / referral partner)**.
- **R-INTAKE-4** IF the submitter identifies as an originator, THEN THE SYSTEM SHALL also gather the borrower's identity and contact info.
- **R-INTAKE-5** THE SYSTEM SHALL conduct intake as a guided conversation, by default following a **Who / What / Where / When / Why** flow (Who: name/contact; What: loan type, amount, term; Where: property address, type, details; When: closing timing; Why: notes), as configured per R-INTAKE-2.
- **R-INTAKE-6** THE SYSTEM SHALL allow the user to provide information by **typed text, uploaded audio, live voice capture, or uploaded documents**, and SHALL **extract the required fields**, confirming captured values back.
- **R-INTAKE-7** IF a required intake field is missing or invalid, THEN THE SYSTEM SHALL ask for it before marking intake complete.
- **R-INTAKE-8** WHEN intake is submitted, THE SYSTEM SHALL **assign the next loan number** (§14), create the Drive loan folder, and record the deal identifier and Drive location.
- **R-INTAKE-9** WHEN intake is submitted, THE SYSTEM SHALL send the submitter (and borrower, if distinct) an **email summary of captured data plus a thank-you** stating next steps: someone will reach out with a quote or feedback **within 24 hours** (subject to R-MAIL-4).
- **R-INTAKE-10** THE SYSTEM SHALL allow intake data to be revised before pre-qualification and record edits in history.
- **R-INTAKE-11** THE SYSTEM SHALL map the **loan type captured at intake to a loan program** (§12), establishing the program that drives pre-qualification rules, checklist, pricing, and templates.
- **R-INTAKE-12** WHEN gathering the borrower, THE SYSTEM SHALL ask the user to select the **borrower type — individual or entity (corporation, LLC, trust)** — and gather the fields appropriate to that type; guarantor(s), where present, are always individuals.
- **R-INTAKE-13** WHERE the loan involves **more than one property**, THE SYSTEM SHALL ask for the additional property information for each property.
- **R-INTAKE-14** WHEN a loan is created through an Account Manager's **personal intake link** (§12), THE SYSTEM SHALL assign that Account Manager to the loan; WHEN an Admin creates the loan, THE SYSTEM SHALL assign the Account Manager chosen by the Admin.

---

## 7. Pre-qualification

**User story:** As the lending team, I want an automatic pre-qualification screen so unqualified deals are flagged early and qualified ones are ready to advance.

- **R-PREQUAL-1** WHEN intake is complete, THE SYSTEM SHALL evaluate the deal against the selected **loan program's** pre-qualification rules (§12).
- **R-PREQUAL-2** THE SYSTEM SHALL produce **Pass / Refer / Fail** with the specific rules that drove it.
- **R-PREQUAL-3** WHEN **Pass**, THE SYSTEM SHALL mark the deal ready to advance to Quote & Term Sheet (advancement still requires Admin approval, R-STAGE-3).
- **R-PREQUAL-4** WHEN **Refer**, THE SYSTEM SHALL route the deal to a lending-team member for manual review.
- **R-PREQUAL-5** WHEN **Fail**, THE SYSTEM SHALL present reasons in chat and SHALL NOT mark ready; a lending-team member may override with a recorded reason.
- **R-PREQUAL-6** THE SYSTEM SHALL record the result and inputs in history and the record.

---

## 8. Quote & Term Sheet (merged)

**User story:** As the lending team, I want the quote presented as a term sheet the borrower can e-sign inline in chat so that pricing and formalization happen in one step.

- **R-QTS-1** THE SYSTEM SHALL merge quoting and term-sheet issuance into a single stage.
- **R-QTS-2** WHERE the selected loan program **has a pricing model** (§12), THE SYSTEM SHALL present the quote as a **term sheet** generated by filling the program's **term-sheet template** (from the Drive templates folder, specified in admin) with loan data via the tagging system (§14).
- **R-QTS-3** WHERE the selected loan program has **no pricing model** (only pasted guidelines), THE SYSTEM SHALL let the lending team produce the quote/term sheet with assistance from those guidelines.
- **R-QTS-4** THE SYSTEM SHALL present the term sheet in the chat with the ability to **open and e-sign it inline** in the chat UI.
- **R-QTS-5** WHEN the borrower accepts and e-signs, THE SYSTEM SHALL record signer, timestamp, and signed-document reference, and SHALL attach an **authentication page confirming the signing time and the signer's IP address/location**.
- **R-QTS-6** THE SYSTEM SHALL store the executed term sheet in the deal's Drive loan folder and mark it **Signed**.
- **R-QTS-7** THE SYSTEM SHALL allow a lending-team member to adjust parameters and re-issue, creating a new version while retaining prior versions; IF modified after signing, THEN THE SYSTEM SHALL require re-signature.
- **R-QTS-8** WHEN the term sheet is signed, THE SYSTEM SHALL mark the deal ready to advance to Processing and notify relevant parties by Gmail (§13).
- **R-QTS-9** THE SYSTEM SHALL support the same template-fill + inline/email e-sign flow for other documents (full Application, Authorization forms, Letters of Explanation, etc.) sourced from the templates folder.
- **R-QTS-10** IF the borrower declines or requests changes, THEN THE SYSTEM SHALL capture the feedback and keep the deal in this stage.

---

## 9. Processing (document collection + review)

**User story:** As Operations, I want documents collected and reviewed concurrently — with AI auto-review where rules exist — so the file becomes complete and validated without manual chasing.

- **R-PROC-1** WHEN a deal enters **Processing**, THE SYSTEM SHALL derive the required-document checklist and task list from the selected loan program (§12).
- **R-PROC-2** THE SYSTEM SHALL make the borrower's **first task** the completion of a **full application**, provided as a **fillable PDF** (from the templates folder, §14) that the borrower can **complete inline in chat and sign**.
- **R-PROC-3** THE SYSTEM SHALL present the checklist in the chat and the Documents pop-out with status **Outstanding / Update Needed / Approved**, kept current as documents arrive and are reviewed.
- **R-PROC-4** WHEN a document is uploaded directly to the chat, THE SYSTEM SHALL prompt the user to **specify the document type**.
- **R-PROC-5** THE SYSTEM SHALL **re-label** each stored document using the **naming convention configured per document in Lender Admin** (§12).
- **R-PROC-6** THE SYSTEM SHALL store each document in the correct location in the deal's Drive loan folder (§14).
- **R-PROC-7** THE SYSTEM SHALL perform collection and review **concurrently** — a document may be reviewed as soon as received.
- **R-PROC-8** WHERE a document type **has AI review rules** defined in the loan program, THE SYSTEM SHALL evaluate the document against them and set the item **Approved** or **Update Needed** with a reason.
- **R-PROC-9** WHERE a document type has **no AI review rules** (review rules are **optional** per document), THE SYSTEM SHALL route it to a lending-team member for review.
- **R-PROC-10** WHEN an item is **Update Needed**, THE SYSTEM SHALL post the reason to the chat and keep the item open until satisfied.
- **R-PROC-11** THE SYSTEM SHALL allow a lending-team member to add, remove, or waive checklist/task items, with a recorded reason.
- **R-PROC-12** THE SYSTEM SHALL compute and display completeness (e.g., "7 of 10 approved, 1 waived, 2 outstanding").
- **R-PROC-13** WHEN all required (non-waived) items are **Approved**, THE SYSTEM SHALL mark the deal ready to advance to Underwriting (Admin approval still required, R-STAGE-3).
- **R-PROC-14** WHERE a document/task is outstanding, THE SYSTEM SHALL be able to send a Gmail reminder to the responsible party, on request or a configured cadence (§13).
- **R-PROC-15** THE SYSTEM SHALL record all collection and review actions (actor — human or AI, status, reason, timestamp) in history.

---

## 10. Underwriting, Final Approval, and Closing

**User story:** As an Admin/underwriter, I want to assemble the file for an underwriting decision, record it, approve final terms, and run closing so the deal reaches a funded outcome.

**Underwriting**
- **R-UW-1** WHEN Processing is complete and the deal advances to Underwriting, THE SYSTEM SHALL assemble an **underwriting summary** from intake, pre-qualification, the signed term sheet, and approved documents, and present it to the underwriter (Admin) in the chat.
- **R-UW-2** THE SYSTEM SHALL allow the underwriter to record a decision of **Approve**, **Approve with conditions**, **Decline**, or **Counter**, with a rationale.
- **R-UW-3** WHEN the decision is **Approve with conditions**, THE SYSTEM SHALL capture the conditions and track each to satisfied/unsatisfied.
- **R-UW-4** WHEN the decision is **Counter**, THE SYSTEM SHALL return the deal to **Quote & Term Sheet** with the countered parameters.
- **R-UW-5** WHEN the decision is **Decline**, THE SYSTEM SHALL move the deal to **Declined** with a recorded reason and notify relevant parties (R-MAIL-4).
- **R-UW-6** THE SYSTEM SHALL record every underwriting decision in history and the record.

**Final Approval**
- **R-APPR-1** THE SYSTEM SHALL require an **Admin** (approver authority) to perform Final Approval.
- **R-APPR-2** IF any approval condition is unsatisfied, THEN THE SYSTEM SHALL block Final Approval and list the outstanding conditions.
- **R-APPR-3** WHEN final terms are approved, THE SYSTEM SHALL **lock the final terms**, generate/store the final-terms/approval document in Drive, and record approver and timestamp.
- **R-APPR-4** WHEN Final Approval is complete, THE SYSTEM SHALL mark the deal ready to advance to Closing.

**Closing**
- **R-CLOSE-1** WHEN a deal enters **Closing**, THE SYSTEM SHALL run a full **document-prep and funding workflow**: generate closing documents from templates (§14) filled via the tagging system, make them available to fill, sign, and **download**, and track the full set of **closing tasks** to completion.
- **R-CLOSE-2** THE SYSTEM SHALL present the closing task/document checklist with status and completeness, and SHALL block funding confirmation until required closing items are complete.
- **R-CLOSE-3** WHEN closing tasks are complete and an Admin confirms **funding/closing**, THE SYSTEM SHALL record the funding/closing confirmation and mark the deal ready to advance to Post-Close.

---

## 11. Tasks

**User story:** As any participant, I want assigned tasks tracked — with lender tasks kept internal — so each party knows what they owe and the team sees everything.

- **R-TASK-1** THE SYSTEM SHALL support tasks derived from the loan program, assignable to specific borrowers or lending-team members (defaults set in admin, §12).
- **R-TASK-2** THE SYSTEM SHALL **not** make lender (lending-team) tasks visible to borrower or originator users.
- **R-TASK-3** THE SYSTEM SHALL make all tasks and their timestamps visible to the lending team.
- **R-TASK-4** THE SYSTEM SHALL display each participant's own outstanding tasks and allow marking them complete, recording actor and timestamp.
- **R-TASK-5** WHEN a task is completed or overdue, THE SYSTEM SHALL reflect it in the deal view and history, and MAY notify via Gmail (§13).

---

## 12. Loan programs and Lender Admin

**User story:** As an Admin, I want a backend to define loan programs, user permissions, intake flows, document naming, pricing, review rules, field edit permissions, and automated emails so the platform fits how we lend.

- **R-ADMIN-1** THE SYSTEM SHALL provide a Lender Admin backend accessible only to **Admin** users.
- **R-ADMIN-2** THE SYSTEM SHALL support three lender user types — **Admin, Operations, Account Manager** — where Admin can update all settings, and Operations and Account Manager can do everything except update Admin settings.
- **R-ADMIN-3** THE SYSTEM SHALL give **Account Manager** users a **CRM** sidebar tab listing contacts (**name, email, phone, notes**) they own.
- **R-ADMIN-4** WHEN a new borrower is added by an Account Manager or applies through that Account Manager's intake link, THE SYSTEM SHALL automatically save the borrower to that Account Manager's CRM.
- **R-ADMIN-4a** THE SYSTEM SHALL provide each Account Manager a **personal intake link** in their settings; loans created through it are assigned to that Account Manager (§6, R-INTAKE-14). WHEN an Admin creates a loan, the Admin assigns the Account Manager.
- **R-ADMIN-5** THE SYSTEM SHALL make **all CRM contacts visible to Admin users**, each clearly **labeled with its owner**, and SHALL allow Admins to own contacts.
- **R-ADMIN-6** THE SYSTEM SHALL allow Admin to create and edit **loan programs**: Bridge, Fix and Flip, New Construction, DSCR, Commercial Bridge, Commercial Permanent, and others.
- **R-ADMIN-7** THE SYSTEM SHALL let each loan program define its own **required-document checklist and task list**, with **default task assignments** to specific borrowers or lending-team members.
- **R-ADMIN-8** THE SYSTEM SHALL let each checklist document carry **optional AI review rules** (what the AI checks for); a document may have none.
- **R-ADMIN-9** THE SYSTEM SHALL let Admin configure a **per-document naming convention** used to re-label stored documents (§9, R-PROC-5).
- **R-ADMIN-10** THE SYSTEM SHALL let each loan program carry its **own pricing**, provided either as an **uploaded pricing model** or as **pasted program guidelines**, used by Quote & Term Sheet (§8).
- **R-ADMIN-11** THE SYSTEM SHALL let Admin specify each program's **term-sheet and application templates** from the Drive templates folder (§14).
- **R-ADMIN-12** THE SYSTEM SHALL let Admin define the **conditional intake form flow** (§6).
- **R-ADMIN-13** THE SYSTEM SHALL let Admin define pre-qualification rules per program (§7).
- **R-ADMIN-14** THE SYSTEM SHALL let Admin configure which **automated emails** are sent and their templates (§13).
- **R-ADMIN-15** THE SYSTEM SHALL let Admin edit **loan data fields** (including adding Trade fields, §16) **at any time**, and configure **field edit permissions** controlling which roles may edit which fields. The default: borrowers may edit their own contact info and mailing address; the lending team edits loan/property/trade fields; all fields lock at Post-Close (R-DATA-8).
- **R-ADMIN-16** THE SYSTEM SHALL record admin configuration changes with actor and timestamp.

---

## 13. Notifications and correspondence (Gmail)

**User story:** As any participant, I want email for the events I care about, with the team approving each send for now.

- **R-MAIL-1** THE SYSTEM SHALL send email via Gmail for key events: intake received (summary + thank-you), pre-qual outcome, term sheet issued/signed, documents/tasks requested and reminders, underwriting decisions, and final approval.
- **R-MAIL-2** THE SYSTEM SHALL address notifications to appropriate parties by role.
- **R-MAIL-3** THE SYSTEM SHALL support both **pushed (user-initiated)** and **automated** emails, with the set of automated emails configurable in admin (R-ADMIN-14).
- **R-MAIL-4** THE SYSTEM SHALL send email **only on per-message approval** by a lending-team user (no silent auto-send in the prototype), including automated emails, which are queued as drafts for approval.
- **R-MAIL-5** THE SYSTEM SHALL record every email sent (recipients, subject, timestamp, reference) in history.
- **R-MAIL-6** THE SYSTEM SHALL use templates for routine notifications, populated from deal data, editable before approval.
- **R-MAIL-7** WHERE inbound email relates to a known deal, THE SYSTEM SHALL be able to associate and surface it in the thread. _(prototype: best-effort; optional.)_

---

## 14. Loan file, numbering, templates, and data tagging (Google Drive)

**User story:** As the lending team, I want every document mirrored to a well-named Drive folder, a reliable loan-number scheme, and a hashtag tagging system so templates fill themselves from loan data.

- **R-DRIVE-1** WHEN intake is submitted, THE SYSTEM SHALL assign the **next loan number** from a monotonically increasing sequence beginning **SPHX500** (then SPHX501, …), and SHALL **never reuse a number**, even if the loan does not proceed.
- **R-DRIVE-2** WHEN a deal is created, THE SYSTEM SHALL create a deal folder inside **Open Loan Files**, named **`Loan Number + Property Address + Borrower Name`**.
- **R-DRIVE-3** THE SYSTEM SHALL mirror every document uploaded in the platform to that deal folder as redundancy/backup.
- **R-DRIVE-4** THE SYSTEM SHALL keep platform documents and Drive in sync **both directions for deletions** (delete in platform → delete in Drive; delete in Drive → remove from platform).
- **R-DRIVE-5** BEFORE deleting a document in the platform, THE SYSTEM SHALL require explicit **delete confirmation**, stating the document will also be removed from Drive.
- **R-DRIVE-6** THE SYSTEM SHALL maintain a Drive **templates folder** holding e-sign/application templates (Term Sheets, full Application PDF, Authorization forms, Letters of Explanation, …), filled from loan data before sending/signing.
- **R-TAG-1** THE SYSTEM SHALL maintain a **loan-data tagging system** assigning each piece of loan data a unique **hashtag** variable (e.g., `#borrowerfirstname`, `#loanamount`, `#interestrate`).
- **R-TAG-2** THE SYSTEM SHALL fill templates by substituting these hashtag variables with the deal's current loan data.
- **R-DRIVE-7** IF a Drive operation fails, THEN THE SYSTEM SHALL report it in the chat and SHALL NOT mark the dependent step complete.
- **R-DRIVE-8** THE SYSTEM SHALL record the Drive location of the deal folder on the deal record and follow the standard Open Loan Files structure.

---

## 15. Post-close interactions

**User story:** As a borrower or the lending team, I want the same conversation to continue after closing so servicing stays in one place.

- **R-POST-1** WHEN a deal reaches Post-Close, THE SYSTEM SHALL keep the shared conversation open for ongoing interactions.
- **R-POST-2** THE SYSTEM SHALL allow post-close requests (payoff questions, document requests, servicing notes) to be captured, tracked to resolution, and recorded.
- **R-POST-3** THE SYSTEM SHALL store post-close documents in the deal's Drive loan folder and reflect them in the record.
- **R-POST-4** THE SYSTEM SHALL preserve full origination and post-close history for the life of the deal record.
- **R-POST-5** WHEN a deal reaches Post-Close (i.e., **closed**), THE SYSTEM SHALL **lock that deal's borrower information** against further propagation/edits (§16, R-DATA-3/4).

---

## 16. Internal notes, AI boundaries, Trade data, and data isolation

**User story:** As the lending team, I want internal notes and trade data borrowers never see, the AI to honor that wall, and loan data isolated per loan — except shared borrower info — so confidential data never leaks and records stay consistent.

**Internal notes & AI wall**
- **R-NOTES-1** THE SYSTEM SHALL provide a lender **Internal Notes** sidebar visible/accessible only to the lending team, with authorship and timestamps.
- **R-NOTES-2** THE SYSTEM SHALL NOT display internal notes or the **Trade** section to borrowers or originators.
- **R-NOTES-3** THE AI SHALL NOT use internal notes, Trade data, or any lender-only information when answering a borrower's or originator's questions.
- **R-NOTES-4** WHEN answering the lending team, THE AI MAY use internal notes and Trade data.

**Trade data**
- **R-TRADE-1** THE SYSTEM SHALL include in the Trade section at least: **Note Buyer, Buy Price, Rate Lock Date, Rate Lock Expiration Date, Loan Package Tracking Number**, with additional Trade fields addable in admin (R-ADMIN-15).

**Data model, isolation & borrower propagation**
- **R-DATA-1** THE SYSTEM SHALL keep each loan's information **isolated to that loan** and SHALL NOT share information between loans, except information **about the same borrower**.
- **R-DATA-2** WHEN a borrower's information changes on one loan, THE SYSTEM SHALL be able to apply that change across all of that borrower's loans.
- **R-DATA-3** THE SYSTEM SHALL NOT propagate borrower-information changes to any of that borrower's loans that have already reached **Post-Close (closed)**.
- **R-DATA-4** WHEN a loan reaches **Post-Close**, THE SYSTEM SHALL **lock** that loan's borrower information against further changes.
- **R-DATA-5** THE SYSTEM SHALL support **multiple borrowers** and **multiple guarantors** (each guarantor an individual) per loan, each with their own data.
- **R-DATA-6** THE SYSTEM SHALL support a **borrower that is an individual or an entity** (corporation, LLC, trust), storing the fields appropriate to the selected type.
- **R-DATA-7** THE SYSTEM SHALL support **multiple properties/collateral** on a single loan, each with its own property data.
- **R-DATA-8** THE SYSTEM SHALL, by default, allow a **borrower to edit their own contact information and mailing address** at any time, while keeping other fields subject to field edit permissions (§12) and locking all of that loan's data at **Post-Close** (R-DATA-4).

---

## 17. Security and authentication

**User story:** As a user, I want secure, low-friction sign-in and to see only loans I'm assigned to.

- **R-AUTH-1** THE SYSTEM SHALL restrict viewing of a deal to the lending team and the borrowers/originators **assigned to that deal**.
- **R-AUTH-2** THE SYSTEM SHALL provide **magic-link sign-in**: entering an email on the login page emails a sign-in link.
- **R-AUTH-3** THE SYSTEM SHALL allow a user to optionally **set a password** and sign in with it.
- **R-AUTH-4** THE SYSTEM SHALL allow **Google login**.
- **R-AUTH-5** THE SYSTEM SHALL allow **multiple borrowers per deal**, invited by an existing borrower on the deal or added by the lender.
- **R-AUTH-6** THE SYSTEM SHALL allow an originator to be assigned to one or more deals.
- **R-AUTH-7** WHEN a **lending-team** user signs in, THE SYSTEM SHALL land them on the **Pipeline View** home (R-UI-8) before any loan is opened; WHEN a **borrower or originator** with access to more than one deal signs in, THE SYSTEM SHALL present the loan picker (R-UI-10).
- **R-AUTH-8** THE SYSTEM SHALL gate Lender Admin to Admin users and gate lending-team views (Pipeline, CRM, Internal Notes, Trade) to lending-team users.

---

## 18. Audit, history, and traceability

- **R-AUDIT-1** THE SYSTEM SHALL maintain an append-only history per deal: messages, field/stage changes, document and task events, reviews, decisions, approvals, emails sent, and signings (with authentication metadata).
- **R-AUDIT-2** THE SYSTEM SHALL attribute each entry to an actor (human or AI/system) with a timestamp.
- **R-AUDIT-3** THE SYSTEM SHALL make history viewable by authorized participants and exclude internal entries from borrower/originator views.

---

## 19. Non-functional requirements _(prototype-scoped)_

- **R-NFR-1 (Usability):** Guided chat prompts let a non-technical borrower complete their part without training.
- **R-NFR-2 (Transparency):** Current stage, outstanding items, and next action visible on request.
- **R-NFR-3 (Data integrity):** Platform/Drive document state kept consistent, honoring two-way deletion (§14) with confirmation.
- **R-NFR-4 (Safety of side effects):** Explicit per-message approval before sending email; confirmation before destructive operations.
- **R-NFR-5 (Confidentiality):** AI access boundary (§16) enforced so lender-only data never reaches borrowers/originators.
- **R-NFR-6 (Extensibility):** External integrations (pipeline, pricing, e-signature, credit/KYC) isolated behind interfaces so mocks can be swapped without changing core flow logic.
- **R-NFR-7 (Auditability):** Every state-changing action recorded in history.
- **R-NFR-8 (Prototype boundaries):** Out-of-scope integrations are mocked, with simulated results clearly indicated.
- **R-NFR-9 (Concurrency):** The shared chat and record SHALL reflect updates from multiple simultaneous participants in near-real-time. _(Implementation in design.)_
- **R-NFR-10 (Visual clarity, v1):** The UI SHALL be minimal and uncluttered — monochrome (black/white) by default, with color reserved for status: document status (**Outstanding = red, Update Needed = yellow, Approved = green**) and stage differentiation; large readable fonts, generous spacing, one clear primary action per context, and status never conveyed by color alone (paired with labels). _(Detail in design §12.1.)_

---

## 20. Confirmed decisions

1. **Loan programs:** Bridge, Fix and Flip, New Construction, DSCR, Commercial Bridge, Commercial Permanent.
2. **Pricing:** uploaded pricing model per program, or pasted program guidelines as the alternative.
3. **E-signing:** inline in chat with email acknowledgement + authentication page (time, IP/location).
4. **Underwriter/approver authority:** held by Admin.
5. **Email:** per-message approval to start (including automated emails).
6. **Stage advancement:** always requires lending-team Admin approval, prompted on opening a ready file.
7. **Voice intake:** both uploaded audio and live voice capture accepted.
8. **Lender user types / naming:** **Originator** = external broker/referral partner; internal relationship owner is **Account Manager**. Lender user types: Admin, Operations, Account Manager.
9. **Full application:** a **fillable PDF**, completed inline in chat and signed.
10. **CRM visibility:** all contacts visible to Admin, labeled by owner; Admins can own contacts.
11. **Guarantors:** multiple allowed, each an individual.
12. **"Closed":** means reaching the **Post-Close** stage.
13. **Assumptions 1–4** confirmed (private/collateral-based lending; single Google account; existing Open Loan Files + Deal Dashboard; shared-chat with internal wall).
14. **Loan program selection:** the intake **loan type maps to a loan program** (R-INTAKE-11).
15. **Borrower type:** borrower may be an **individual or entity (corporation, LLC, trust)**, selected at intake; guarantors are always individuals (R-INTAKE-12, R-DATA-6).
16. **Multiple properties:** supported per loan; the AI gathers additional property info (R-INTAKE-13, R-DATA-7).
17. **Field edit permissions:** borrowers may edit their own contact info and mailing address; other fields locked post-close (R-DATA-8, R-ADMIN-15).
18. **Account Manager assignment:** via the Account Manager's **personal intake link**, or Admin assignment when the Admin creates the loan (R-INTAKE-14, R-ADMIN-4a).
19. **Closing:** a full **document-prep and funding workflow** — templates filled, signed, and downloaded, with many closing tasks (R-CLOSE-1..3).
20. **System of record:** the platform **datastore is primary; Google Drive is a synchronized backup** to ease the team's transition (§1.1).

---

## 21. Open questions

_All requirement-level questions are resolved (§20). Remaining choices are implementation decisions for `design.md` — notably the specific datastore/hosting, the real-time transport for the shared chat, the e-sign rendering approach, and how the loan-program ↔ loan-type mapping is configured._

---

_Next phase on approval: `design.md` — architecture, data model, component and chat-orchestration design, Drive/Gmail integration, stage gating, tagging/templates, auth, and the AI access-boundary implementation._
