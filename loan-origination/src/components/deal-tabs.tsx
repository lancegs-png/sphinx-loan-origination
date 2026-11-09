"use client";

import { useState } from "react";
import { Chat } from "./chat";
import { FloatingChat } from "./floating-chat";
import { LoanData } from "./loan-data";
import { QuotePanel } from "./quote-panel";
import { DocumentsPanel } from "./documents-panel";
import { TemplatesPanel } from "./templates-panel";
import { PeoplePanel } from "./people-panel";
import { NotesPanel } from "./notes-panel";
import type {
  ChecklistItem,
  DealContact,
  FieldDef,
  FieldValues,
  InternalNote,
  Loan,
  LoanDocument,
  Message,
  Participant,
} from "@/lib/types";

type Tab = "loan" | "chat" | "documents" | "people" | "quote" | "templates" | "notes";

/**
 * The deal workspace as a single tabbed surface. Loan Info is the landing tab; the
 * agent chat is both its own full-height tab and a floating popup reachable from any
 * other tab (so the deal can be updated by chat without leaving the current view).
 * Lender-only tabs (Quote, Templates, Internal Notes) are hidden from borrowers.
 */
export function DealTabs({
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
  atProcessing: boolean;
}) {
  const [tab, setTab] = useState<Tab>("loan");

  const tabs: { key: Tab; label: string; lenderOnly?: boolean }[] = [
    { key: "loan", label: "Loan Info" },
    { key: "chat", label: "Chat" },
    { key: "documents", label: "Documents" },
    { key: "people", label: "People" },
    { key: "quote", label: "Quote", lenderOnly: true },
    { key: "templates", label: "Templates", lenderOnly: true },
    { key: "notes", label: "Internal Notes", lenderOnly: true },
  ];

  const extraContacts = (loan.custom_fields?.contacts as DealContact[] | undefined) ?? [];

  const chatProps = {
    loanId: loan.id,
    initialMessages: messages,
    currentUserId,
    currentRole,
    isLender,
    intakeMode,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-line px-4 sm:px-6">
        {tabs
          .filter((t) => !t.lenderOnly || isLender)
          .map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={active ? "true" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  active ? "border-gold text-navy" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            );
          })}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Chat tab — kept mounted so its thread stays in sync with the popup */}
        <div className={tab === "chat" ? "mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col" : "hidden"}>
          <Chat {...chatProps} />
        </div>

        {/* Data panels — Loan Info gets extra width for its dense, spreadsheet-style grid */}
        {tab !== "chat" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              className={`mx-auto px-4 py-6 text-sm sm:px-6 ${
                tab === "loan" ? "max-w-7xl" : "max-w-5xl"
              }`}
            >
              {tab === "loan" && (
                <LoanData
                  loan={loan}
                  fieldDefs={fieldDefs}
                  values={fieldValues}
                  canEdit={isLender}
                  isLender={isLender}
                />
              )}

              {tab === "documents" && (
                <DocumentsPanel
                  loanId={loan.id}
                  items={checklist}
                  documents={documents}
                  canEdit={isLender}
                  canGenerate={isLender && atProcessing}
                />
              )}

              {tab === "people" && (
                <PeoplePanel
                  loanId={loan.id}
                  participants={participants}
                  values={fieldValues}
                  initialContacts={extraContacts}
                  canEdit={isLender}
                />
              )}

              {tab === "quote" && isLender && <QuotePanel loan={loan} values={fieldValues} />}

              {tab === "templates" && isLender && (
                <TemplatesPanel
                  loanId={loan.id}
                  programKey={loan.loan_program ?? loan.loan_type}
                  values={fieldValues}
                />
              )}

              {tab === "notes" && isLender && (
                <NotesPanel loanId={loan.id} initialNotes={internalNotes} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating chat — available from every tab except the full Chat tab */}
      <FloatingChat dormant={tab === "chat"} {...chatProps} />
    </div>
  );
}
