// Pure, client-safe helpers for loan activity events (no server-only imports), so
// both the client Activity panel and the server-side PDF route can share them.

/** A loan activity event, with the actor's profile joined for display. */
export type ActivityEvent = {
  id: string;
  event_type: string;
  actor_kind: string; // human | ai | system
  is_internal: boolean;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor?: { full_name: string | null; email: string | null } | null;
};

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

/** Who performed an event, for display. */
export function actorName(e: ActivityEvent): string {
  if (e.actor_kind === "ai") return "AI System";
  if (e.actor_kind === "system") return "System";
  return e.actor?.full_name || e.actor?.email || "User";
}

/**
 * Human-readable description of an event, shared by the Activity tab and the PDF log.
 * `labelFor` resolves a field key to its label (for data-update events).
 */
export function describeEvent(e: ActivityEvent, labelFor?: (key: string) => string): string {
  const p = e.payload ?? {};
  switch (e.event_type) {
    case "loan_created":
      return "Loan created";
    case "intake_recorded":
      return "Intake details recorded";
    case "field_updated": {
      const key = String(p.key ?? "");
      const label = (labelFor && key ? labelFor(key) : "") || String(p.label ?? key) || "Field";
      return `${label}: ${fmtVal(p.old)} → ${fmtVal(p.new)}`;
    }
    case "document_uploaded":
      return `Document uploaded: ${fmtVal(p.file_name)}`;
    case "document_deleted":
      return `Document removed: ${fmtVal(p.file_name)}`;
    case "template_downloaded":
      return `Template downloaded: ${fmtVal(p.template ?? p.templateId)}${p.format ? ` (${p.format})` : ""}`;
    case "term_sheet_generated":
      return "Term sheet generated";
    case "term_sheet_signed":
      return "Term sheet signed";
    case "quote_posted":
      return "Quote posted to borrower";
    case "checklist_status":
      return `Checklist status: ${fmtVal(p.old)} → ${fmtVal(p.new)}`;
    case "sheet_synced":
      return "Synced to Google Sheet";
    default:
      return e.event_type.replace(/_/g, " ");
  }
}
