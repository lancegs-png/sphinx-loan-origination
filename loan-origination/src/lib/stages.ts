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

/**
 * Business-facing funnel buckets. The eight canonical `STAGES` roll up into
 * these six; every stage belongs to exactly one bucket. Shared by the pipeline
 * overview tiles and the deal-view stage bar so both read the same.
 */
export const STAGE_BUCKETS = [
  { label: "Opportunity", stages: ["intake", "pre_qualification"] },
  { label: "Quoted", stages: ["quote_term_sheet"] },
  { label: "Processing", stages: ["processing"] },
  { label: "Underwriting", stages: ["underwriting", "final_approval"] },
  { label: "Closing", stages: ["closing"] },
  { label: "Closed", stages: ["post_close"] },
] as const;

/** Index of the bucket that contains `stage`, or -1 if unknown. */
export function bucketIndex(stage: string): number {
  return STAGE_BUCKETS.findIndex((b) => (b.stages as readonly string[]).includes(stage));
}
