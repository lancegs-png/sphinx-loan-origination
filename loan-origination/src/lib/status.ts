// Loan lifecycle status (the loan_status enum) — distinct from the pipeline stage.
// "active" is the normal in-progress state; the rest mark a loan that isn't moving
// forward. "archived" also hides the loan from the pipeline list.
export const LOAN_STATUSES = [
  { key: "active", label: "Active" },
  { key: "on_hold", label: "On Hold" },
  { key: "withdrawn", label: "Withdrawn" },
  { key: "declined", label: "Declined" },
  { key: "archived", label: "Archived" },
] as const;

export type LoanStatusKey = (typeof LOAN_STATUSES)[number]["key"];

export function statusLabel(key: string): string {
  return LOAN_STATUSES.find((s) => s.key === key)?.label ?? key;
}

export function isLoanStatus(key: string): key is LoanStatusKey {
  return LOAN_STATUSES.some((s) => s.key === key);
}
