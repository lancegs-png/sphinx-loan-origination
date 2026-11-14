"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Chat } from "./chat";
import { FloatingChat } from "./floating-chat";
import { LoanData } from "./loan-data";

// Heavier, non-landing tab panels are code-split: their JS downloads on first open
// instead of shipping with the deal page. Loan Info (landing) and Chat (always mounted)
// stay eager.
const PanelLoading = () => <div className="p-4 text-sm text-muted">Loading…</div>;
const QuotePanel = dynamic(() => import("./quote-panel").then((m) => m.QuotePanel), { loading: PanelLoading });
const DocumentsPanel = dynamic(() => import("./documents-panel").then((m) => m.DocumentsPanel), { loading: PanelLoading });
const TemplatesPanel = dynamic(() => import("./templates-panel").then((m) => m.TemplatesPanel), { loading: PanelLoading });
const PeoplePanel = dynamic(() => import("./people-panel").then((m) => m.PeoplePanel), { loading: PanelLoading });
const NotesPanel = dynamic(() => import("./notes-panel").then((m) => m.NotesPanel), { loading: PanelLoading });
const ActivityPanel = dynamic(() => import("./activity-panel").then((m) => m.ActivityPanel), { loading: PanelLoading });
import type { ActivityEvent } from "@/lib/activity";
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

type Tab = "loan" | "chat" | "documents" | "people" | "quote" | "templates" | "notes" | "activity";

const NAV_COLLAPSE_KEY = "sphinx.deal.nav.collapsed";

// One small line icon per tab for the left nav (feather-style, inherits currentColor).
const svg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const TAB_ICON: Record<Tab, ReactNode> = {
  loan: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>),
  chat: svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  documents: svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  people: svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  quote: svg(<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  templates: svg(<><rect x="3" y="3" width="13" height="13" rx="2" /><path d="M8 21h11a2 2 0 0 0 2-2V8" /></>),
  notes: svg(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></>),
  activity: svg(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />),
};

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
  const [tab, setTab] = useState<Tab>("loan");
  const [collapsed, setCollapsed] = useState(false);

  // Remember the nav collapsed/expanded choice per browser.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(NAV_COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(NAV_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const tabs: { key: Tab; label: string; lenderOnly?: boolean }[] = [
    { key: "loan", label: "Loan Info" },
    { key: "chat", label: "Chat" },
    { key: "documents", label: "Documents" },
    { key: "people", label: "People" },
    { key: "quote", label: "Quote", lenderOnly: true },
    { key: "templates", label: "Templates", lenderOnly: true },
    { key: "notes", label: "Internal Notes", lenderOnly: true },
    { key: "activity", label: "Activity", lenderOnly: true },
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
    <div className="flex min-h-0 flex-1 bg-surface">
      {/* Left nav — collapsible; icons only when collapsed, icon + label when expanded */}
      <nav
        className={`flex shrink-0 flex-col border-r border-line bg-surface-2/30 py-2 transition-[width] duration-200 ${
          collapsed ? "w-[52px]" : "w-48"
        }`}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand" : "Collapse"}
          className={`mb-1 flex items-center rounded-md p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg ${
            collapsed ? "mx-auto" : "ml-auto mr-2"
          }`}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden
            className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex flex-col gap-0.5 px-2">
          {tabs
            .filter((t) => !t.lenderOnly || isLender)
            .map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={active ? "true" : undefined}
                  title={collapsed ? t.label : undefined}
                  className={`flex items-center gap-2.5 rounded-md py-2 text-sm font-medium transition-colors ${
                    collapsed ? "justify-center px-0" : "px-2.5"
                  } ${active ? "bg-gold/10 text-navy" : "text-muted hover:bg-surface-2 hover:text-fg"}`}
                >
                  <span className="shrink-0">{TAB_ICON[t.key]}</span>
                  {!collapsed && <span className="truncate">{t.label}</span>}
                </button>
              );
            })}
        </div>
      </nav>

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

              {tab === "activity" && isLender && (
                <ActivityPanel loanId={loan.id} events={activity} fieldLabels={fieldLabels} />
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
