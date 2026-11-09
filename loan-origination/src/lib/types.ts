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

export type MessagePayload = {
  form?: { intro?: string; fields: FormFieldSpec[] };
  proceed?: boolean; // renders Yes/No ("proceed with the quoted terms?")
  sign?: boolean; // renders a "Sign term sheet" control
  doc?: { title: string; url: string }; // renders a clickable document card (opens in a new tab)
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
  assignee: string; // borrower | lending_team
  guidance: string | null;
  status: string; // doc_status: outstanding | ordered | update_needed | approved | not_applicable
  notes: string | null;
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
