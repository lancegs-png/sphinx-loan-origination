"use client";

import { useState } from "react";
import { Chat } from "./chat";
import { LoanData } from "./loan-data";
import { QuotePanel } from "./quote-panel";
import { DocumentsPanel } from "./documents-panel";
import { TemplatesPanel } from "./templates-panel";
import type {
  ChecklistItem,
  FieldDef,
  FieldValues,
  InternalNote,
  Loan,
  Message,
  Participant,
} from "@/lib/types";

type Tab = "chat" | "loan" | "documents" | "people" | "quote" | "templates" | "notes";

function participantRoleLabel(role: string) {
  if (role === "lending_team") return "Lending team";
  if (role === "originator") return "Originator";
  if (role === "borrower") return "Borrower";
  return role;
}

/**
 * The deal workspace as a single tabbed surface: Chat lives alongside the loan
 * panels in one tab bar, and the active tab fills the content area full-width.
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
  atProcessing: boolean;
}) {
  const [tab, setTab] = useState<Tab>("chat");

  const tabs: { key: Tab; label: string; lenderOnly?: boolean }[] = [
    { key: "chat", label: "Chat" },
    { key: "loan", label: "Loan Info" },
    { key: "documents", label: "Documents" },
    { key: "people", label: "People" },
    { key: "quote", label: "Quote", lenderOnly: true },
    { key: "templates", label: "Templates", lenderOnly: true },
    { key: "notes", label: "Internal Notes", lenderOnly: true },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {/* Tab bar — Chat + every loan panel in one menu */}
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

      {/* Chat fills + scrolls itself; the other panels get a centered, scrollable column */}
      {tab === "chat" ? (
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <Chat
            loanId={loan.id}
            initialMessages={messages}
            currentUserId={currentUserId}
            currentRole={currentRole}
            isLender={isLender}
            intakeMode={intakeMode}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-4 py-6 text-sm sm:px-6">
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
                canEdit={isLender}
                canGenerate={isLender && atProcessing}
              />
            )}

            {tab === "people" && (
              <ul className="space-y-3">
                {participants.map((p) => (
                  <li key={p.user_id} className="card p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-fg">
                        {p.profiles?.full_name ?? p.profiles?.email ?? "—"}
                      </span>
                      <span className="chip">{participantRoleLabel(p.participant_role)}</span>
                    </div>
                    {p.profiles?.email && <div className="mt-1 text-muted">{p.profiles.email}</div>}
                    {p.profiles?.phone && <div className="text-muted">{p.profiles.phone}</div>}
                  </li>
                ))}
              </ul>
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
              <ul className="space-y-3">
                {internalNotes.length === 0 && <p className="text-muted">No internal notes.</p>}
                {internalNotes.map((n) => (
                  <li key={n.id} className="card p-3.5">
                    <p className="whitespace-pre-wrap text-fg">{n.body}</p>
                    <div className="mt-1.5 text-xs text-faint">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
