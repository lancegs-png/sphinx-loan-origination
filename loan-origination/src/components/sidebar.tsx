"use client";

import { useState } from "react";
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
  Participant,
} from "@/lib/types";

type Tab = "people" | "documents" | "loan" | "quote" | "templates" | "notes";

function participantRoleLabel(role: string) {
  if (role === "lending_team") return "Lending team";
  if (role === "originator") return "Originator";
  if (role === "borrower") return "Borrower";
  return role;
}

export function Sidebar({
  loan,
  participants,
  internalNotes,
  isLender,
  fieldDefs,
  fieldValues,
  checklist,
  atProcessing,
}: {
  loan: Loan;
  participants: Participant[];
  internalNotes: InternalNote[];
  isLender: boolean;
  fieldDefs: FieldDef[];
  fieldValues: FieldValues;
  checklist: ChecklistItem[];
  atProcessing: boolean;
}) {
  const [tab, setTab] = useState<Tab>("people");

  const tabs: { key: Tab; label: string; lenderOnly?: boolean }[] = [
    { key: "people", label: "People" },
    { key: "documents", label: "Documents" },
    { key: "loan", label: "Loan Info" },
    { key: "quote", label: "Quote", lenderOnly: true },
    { key: "templates", label: "Templates", lenderOnly: true },
    { key: "notes", label: "Internal Notes", lenderOnly: true },
  ];

  return (
    <aside className="flex w-full flex-col border-l border-line bg-surface md:w-80">
      <div className="flex gap-1 overflow-x-auto border-b border-line px-2">
        {tabs
          .filter((t) => !t.lenderOnly || isLender)
          .map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={active ? "true" : undefined}
                className={`whitespace-nowrap border-b-2 px-2.5 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-gold text-navy"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            );
          })}
      </div>

      <div className="flex-1 overflow-y-auto p-5 text-sm">
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

        {tab === "documents" && (
          <DocumentsPanel
            loanId={loan.id}
            items={checklist}
            canEdit={isLender}
            canGenerate={isLender && atProcessing}
          />
        )}

        {tab === "quote" && isLender && (
          <QuotePanel loan={loan} values={fieldValues} />
        )}

        {tab === "loan" && (
          <LoanData
            loan={loan}
            fieldDefs={fieldDefs}
            values={fieldValues}
            canEdit={isLender}
            isLender={isLender}
          />
        )}

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
                <div className="mt-1.5 text-xs text-faint">{new Date(n.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
