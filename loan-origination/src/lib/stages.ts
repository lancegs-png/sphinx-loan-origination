// Canonical loan stages (requirements §5 / design §7).
export const STAGES = [
  { key: "intake", label: "Intake" },
  { key: "pre_qualification", label: "Pre-Qual" },
  { key: "quote_term_sheet", label: "Quote & Term Sheet" },
  { key: "processing", label: "Processing" },
  { key: "underwriting", label: "Underwriting" },
  { key: "final_approval", label: "Final Approval" },
  { key: "closing", label: "Closing" },
  { key: "post_close", label: "Post-Close" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export function stageLabel(key: string): string {
  return STAGES.find((s) => s.key === key)?.label ?? key;
}

export function stageIndex(key: string): number {
  return STAGES.findIndex((s) => s.key === key);
}
