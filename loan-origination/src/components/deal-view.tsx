import Link from "next/link";
import { StageBar } from "./stage-bar";
import { Chat } from "./chat";
import { Sidebar } from "./sidebar";
import type { InternalNote, Loan, Message, Participant } from "@/lib/types";

export function DealView({
  loan,
  messages,
  participants,
  internalNotes,
  currentUserId,
  currentRole,
  isLender,
  intakeMode,
}: {
  loan: Loan;
  messages: Message[];
  participants: Participant[];
  internalNotes: InternalNote[];
  currentUserId: string;
  currentRole: string;
  isLender: boolean;
  intakeMode: boolean;
}) {
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-muted underline">
            ← Pipeline
          </Link>
          <form action="/auth/signout" method="post">
            <button className="text-sm text-muted underline">Sign out</button>
          </form>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-lg font-semibold">
            {loan.property_address ?? loan.loan_number}
          </span>
          <span className="text-muted">{loan.loan_type ?? "—"}</span>
          <span className="text-muted">
            {loan.loan_amount != null ? `$${loan.loan_amount.toLocaleString()}` : "—"}
          </span>
          <span className="text-muted">Close: {loan.expected_close_date ?? "—"}</span>
        </div>
        <div className="mt-4">
          <StageBar currentStage={loan.stage} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <Chat
          loanId={loan.id}
          initialMessages={messages}
          currentUserId={currentUserId}
          currentRole={currentRole}
          isLender={isLender}
          intakeMode={intakeMode}
        />
        <Sidebar
          loan={loan}
          participants={participants}
          internalNotes={internalNotes}
          isLender={isLender}
        />
      </div>
    </div>
  );
}
