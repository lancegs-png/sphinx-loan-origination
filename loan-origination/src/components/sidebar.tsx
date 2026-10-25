"use client";

import { useState } from "react";
import type { InternalNote, Loan, Participant } from "@/lib/types";

type Tab = "people" | "documents" | "loan" | "notes";

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
}: {
  loan: Loan;
  participants: Participant[];
  internalNotes: InternalNote[];
  isLender: boolean;
}) {
  const [tab, setTab] = useState<Tab>("people");

  const tabs: { key: Tab; label: string; lenderOnly?: boolean }[] = [
    { key: "people", label: "People" },
    { key: "documents", label: "Documents" },
    { key: "loan", label: "Loan Info" },
    { key: "notes", label: "Internal Notes", lenderOnly: true },
  ];

  return (
    <aside className="flex w-full flex-col border-l border-line md:w-80">
      <div className="flex border-b border-line">
        {tabs
          .filter((t) => !t.lenderOnly || isLender)
          .map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 px-3 py-3 text-sm font-medium"
              style={{
                color: tab === t.key ? "var(--fg)" : "var(--muted)",
                borderBottom: tab === t.key ? "2px solid var(--fg)" : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 text-sm">
        {tab === "people" && (
          <ul className="space-y-4">
            {participants.map((p) => (
              <li key={p.user_id}>
                <div className="font-medium">{p.profiles?.full_name ?? p.profiles?.email ?? "—"}</div>
                <div className="text-muted">{participantRoleLabel(p.participant_role)}</div>
                {p.profiles?.email && <div className="text-muted">{p.profiles.email}</div>}
                {p.profiles?.phone && <div className="text-muted">{p.profiles.phone}</div>}
              </li>
            ))}
          </ul>
        )}

        {tab === "documents" && <p className="text-muted">No documents yet.</p>}

        {tab === "loan" && (
          <dl className="space-y-3">
            <Field label="Loan number" value={loan.loan_number} />
            <Field label="Loan type" value={loan.loan_type} />
            <Field label="Amount" value={loan.loan_amount != null ? `$${loan.loan_amount.toLocaleString()}` : null} />
            <Field label="Property" value={loan.property_address} />
            <Field label="Borrower" value={loan.borrower_name} />
            <Field label="Expected close" value={loan.expected_close_date} />
          </dl>
        )}

        {tab === "notes" && isLender && (
          <ul className="space-y-4">
            {internalNotes.length === 0 && <p className="text-muted">No internal notes.</p>}
            {internalNotes.map((n) => (
              <li key={n.id}>
                <p className="whitespace-pre-wrap">{n.body}</p>
                <div className="text-muted">{new Date(n.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value ?? "—"}</dd>
    </div>
  );
}
