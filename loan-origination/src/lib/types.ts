export type LenderUserType = "admin" | "operations" | "account_manager";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  is_lending_team: boolean;
  lender_user_type: LenderUserType | null;
};

export type Loan = {
  id: string;
  loan_number: string | null; // assigned only once the term sheet is signed
  opportunity_number: string; // assigned at intake, always present
  program_id: string | null;
  account_manager_id: string | null;
  stage: string;
  status: string;
  loan_type: string | null;
  loan_program: string | null;
  loan_amount: number | null;
  property_address: string | null;
  borrower_name: string | null;
  closing_date: string | null;
  custom_fields?: Record<string, unknown> | null;
  created_at: string;
};

export type FormFieldSpec = {
  key: string;
  label: string;
  type?: "text" | "number" | "currency" | "date" | "select";
  options?: string[];
  required?: boolean;
};

// AI-proposed record changes, awaiting the user's Confirm (renders a review card).
export type ProposedUpdatesPayload = {
  summary: string;
  fields: { key: string; label: string; value: string }[];
  stage: { key: string; label: string } | null;
  checklist: { document: string; status: string }[];
};

export type MessagePayload = {
  form?: { intro?: string; fields: FormFieldSpec[] };
  proceed?: boolean; // renders Yes/No ("proceed with the quoted terms?")
  sign?: boolean; // renders a "Sign term sheet" control
  doc?: { title: string; url: string }; // renders a clickable document card (opens in a new tab)
  updates?: ProposedUpdatesPayload; // renders a Confirm/Cancel card for AI-proposed changes
};

export type Message = {
  id: string;
  loan_id: string;
  sender_user_id: string | null;
  sender_kind: string; // human | ai | system
  sender_role: string | null;
  is_internal: boolean;
  body: string;
  payload?: MessagePayload | null;
  created_at: string;
};

export type Participant = {
  loan_id: string;
  user_id: string;
  participant_role: string;
  profiles?: Profile | null;
};

export type FieldDef = {
  key: string;
  label: string;
  section: string; // loan | property | borrower | guarantor | trade | contact
  type: "text" | "number" | "currency" | "percent" | "date" | "select";
  options: string[];
  lender_only: boolean;
  sort: number;
  verifiable: boolean;
  repeat_group: string | null; // 'property' | 'guarantor' | null
  source: string | null; // intake | manual | calculated | system | config
  required_stage: string | null;
  calc_key: string | null;
  programs: string[]; // loan_type_keys this field applies to; empty = all programs
};

// One field's stored values for a loan (idx handled by the map key).
export type FieldCell = {
  initial: unknown;
  verified: unknown;
  locked: boolean;
  current: unknown; // verified ?? initial
};
// Keyed by field key for idx 1, or `${key}#${idx}` for repeats.
export type FieldValues = Record<string, FieldCell>;

export type ChecklistItem = {
  id: string;
  documentTypeId: string;
  name: string;
  category: string | null;
  assignee: string; // borrower | lending_team (kept for AI context; no longer shown in the UI)
  visibility: string; // all | lender_only — who sees this document on the deal
  guidance: string | null;
  status: string; // doc_status: outstanding | ordered | update_needed | approved | not_applicable
  notes: string | null;
};

/** One stage-checklist task for a loan, with its completion state (StageTaskGroup → tasks). */
export type StageTask = {
  id: string;
  label: string;
  done: boolean;
  note: string | null;
  completedBy: string | null; // display name of who last completed it
  completedAt: string | null; // ISO timestamp
  visibility: string; // all | lender_only — who sees this task on the deal
  assignedTo: string | null; // lender | borrower | broker | null
};

/** Stage-checklist tasks for a loan, grouped by pipeline bucket. */
export type StageTaskGroup = {
  bucketKey: string;
  bucketLabel: string;
  tasks: StageTask[];
};

export type LoanDocument = {
  id: string;
  checklist_item_id: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  drive_web_link: string | null;
  created_at: string;
};

export type InternalNote = {
  id: string;
  loan_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: { full_name: string | null; email: string | null } | null;
};

// A free-form deal contact without an app login (stored on loans.custom_fields.contacts).
export type DealContact = {
  id: string;
  label: string; // e.g. "Title / closing agent", "Appraiser"
  name: string;
  email: string;
  phone: string;
};

// ---- Reusable party records (the Guarantors & Entities library). All string-valued for the
// editors; the server actions map to/from the DB columns. ----
export type Guarantor = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ssn: string;
  dateOfBirth: string; // YYYY-MM-DD or ""
  mailingAddress: string;
};

export type EntityMember = {
  id?: string;
  name: string;
  ownershipPct: string; // percent as a string for the input
  guarantorId: string | null;
};

export type Entity = {
  id: string;
  name: string;
  ein: string;
  mailingAddress: string;
  entityType: string;
  stateOfFormation: string;
  members: EntityMember[];
};
