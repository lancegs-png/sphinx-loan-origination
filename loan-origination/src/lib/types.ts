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
  loan_number: string;
  program_id: string | null;
  account_manager_id: string | null;
  stage: string;
  status: string;
  loan_type: string | null;
  loan_amount: number | null;
  property_address: string | null;
  borrower_name: string | null;
  expected_close_date: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  loan_id: string;
  sender_user_id: string | null;
  sender_kind: string; // human | ai | system
  sender_role: string | null;
  is_internal: boolean;
  body: string;
  created_at: string;
};

export type Participant = {
  loan_id: string;
  user_id: string;
  participant_role: string;
  profiles?: Profile | null;
};

export type InternalNote = {
  id: string;
  loan_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};
