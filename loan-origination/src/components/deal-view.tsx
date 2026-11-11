import Link from "next/link";
import { StageBar } from "./stage-bar";
import { StageSelect } from "./stage-select";
import { DealTabs } from "./deal-tabs";
import type { ActivityEvent } from "@/lib/activity";
import type {
  ChecklistItem,
  FieldDef,
  FieldValues,
  InternalNote,
  Loan,
  LoanDocument,
  Message,
  Participant,
} from "@/lib/types";

/** Format a stored YYYY-MM-DD date as MM/DD/YYYY (no timezone shift); "—" when empty. */
function fmtCloseDate(d: string | null | undefined): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : d;
}

export function DealView({
  loan,
  messages,
  participants,
  internalNotes,
  currentUserId,
  currentRole,
  isLender,
  intakeMode,
  fieldDefs,
  fieldValues,
  checklist,
  documents,
  activity,
  fieldLabels,
  atProcessing,
}: {
  loan: Loan;
  messages: Message[];
  participants: Participant[];
  internalNotes: InternalNote[];
  currentUserId: string;
  currentRole: string;
  isLender: boolean;
  intakeMode: boolean;
  fieldDefs: FieldDef[];
  fieldValues: FieldValues;
  checklist: ChecklistItem[];
  documents: LoanDocument[];
  activity: ActivityEvent[];
  fieldLabels: Record<string, string>;
  atProcessing: boolean;
}) {
  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-fg"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Pipeline
          </Link>
          <form action="/auth/signout" method="post">
            <button className="btn btn-ghost text-sm">Sign out</button>
          </form>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-xl font-bold text-fg">
            {loan.property_address ?? loan.loan_number ?? loan.opportunity_number}
          </h1>
          <span className="chip">
            {loan.loan_number ?? `${loan.opportunity_number} · opportunity`}
          </span>
          {loan.loan_type && <span className="chip">{loan.loan_type}</span>}
          {loan.loan_amount != null && (
            <span className="text-sm font-medium tabular-nums text-fg">
              ${loan.loan_amount.toLocaleString()}
            </span>
          )}
          <span className="text-sm text-muted">Close {fmtCloseDate(loan.closing_date)}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <StageBar currentStage={loan.stage} />
          {isLender && <StageSelect loanId={loan.id} currentStage={loan.stage} />}
        </div>
      </header>

      <DealTabs
        loan={loan}
        messages={messages}
        participants={participants}
        internalNotes={internalNotes}
        currentUserId={currentUserId}
        currentRole={currentRole}
        isLender={isLender}
        intakeMode={intakeMode}
        fieldDefs={fieldDefs}
        fieldValues={fieldValues}
        checklist={checklist}
        documents={documents}
        activity={activity}
        fieldLabels={fieldLabels}
        atProcessing={atProcessing}
      />
    </div>
  );
}
