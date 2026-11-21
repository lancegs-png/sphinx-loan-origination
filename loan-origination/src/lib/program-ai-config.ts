// Config types for a loan program's AI-intake quote fields, used by the program-config editor
// and the saveProgramAiConfig action. Previously defined in src/lib/ai/intake.ts (the retired
// AI chat-intake backend), relocated here so that file could be removed.

export type FieldType = "text" | "number" | "currency" | "date" | "select";

export type QuoteField = {
  key: string;
  label: string;
  required?: boolean;
  type?: FieldType;
  options?: string[];
};
