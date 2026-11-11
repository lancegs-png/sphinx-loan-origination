"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { askAi, intakeTurn, generateTermSheet, signTermSheet, applyLoanUpdates } from "@/app/actions";
import { IntakeFormCard } from "@/components/intake-form-card";
import type { Message, ProposedUpdatesPayload } from "@/lib/types";

function roleLabel(m: Message): string {
  if (m.sender_kind === "ai") return "AI System";
  if (m.sender_kind === "system") return "System";
  switch (m.sender_role) {
    case "lending_team":
      return "Lending team";
    case "originator":
      return "Originator";
    case "borrower":
      return "Borrower";
    default:
      return "User";
  }
}

export function Chat({
  loanId,
  initialMessages,
  currentUserId,
  currentRole,
  isLender,
  intakeMode,
}: {
  loanId: string;
  initialMessages: Message[];
  currentUserId: string;
  currentRole: string;
  isLender: boolean;
  intakeMode: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    (async () => {
      // Realtime applies RLS, so the socket must carry the user's access token — without
      // it the connection is anon and the messages SELECT policy (auth.uid()) drops every
      // event, so AI replies and other participants' messages never arrive live.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (!active) return;

      channel = supabase
        .channel(`messages:${loanId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `loan_id=eq.${loanId}` },
          (payload) => {
            const m = payload.new as Message;
            // Defense in depth: never render an internal message to a non-lender,
            // even if one somehow arrives on the channel (RLS should already prevent it).
            if (m.is_internal && !isLender) return;
            setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [loanId, isLender, supabase]);

  async function insertHuman(text: string, markInternal: boolean): Promise<boolean> {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        loan_id: loanId,
        sender_user_id: currentUserId,
        sender_kind: "human",
        sender_role: currentRole,
        is_internal: isLender ? markInternal : false,
        body: text,
      })
      .select("*")
      .single();
    if (error || !data) return false;
    const m = data as Message;
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    return true;
  }

  // Re-sync from the DB (RLS-filtered) after an AI turn, so the AI reply shows even if
  // the realtime event is delayed or dropped. Merges by id, so nothing is duplicated.
  async function refreshMessages() {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("loan_id", loanId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const ok = await insertHuman(text, intakeMode ? false : internal);
    setBusy(false);
    if (!ok) return;
    setBody("");

    // While the loan is in Intake, each message drives the AI intake conversation.
    if (intakeMode) {
      setAiError(null);
      setAiBusy(true);
      const res = await intakeTurn(loanId, text);
      setAiBusy(false);
      if (!res.ok) setAiError(res.error ?? "Intake couldn’t continue.");
      await refreshMessages();
    }
  }

  async function submitForm(fields: { key: string; label: string }[], values: Record<string, string>) {
    const text = fields
      .filter((f) => values[f.key] != null && values[f.key] !== "")
      .map((f) => `${f.label}: ${values[f.key]}`)
      .join("; ");
    if (!text) return;
    setBusy(true);
    const ok = await insertHuman(text, false);
    setBusy(false);
    if (!ok) return;
    setAiError(null);
    setAiBusy(true);
    const res = await intakeTurn(loanId, text);
    setAiBusy(false);
    if (!res.ok) setAiError(res.error ?? "Intake couldn’t continue.");
    await refreshMessages();
  }

  // Borrower accepts (or declines) the quoted terms. On Yes, the AI generates a term sheet.
  async function proceedQuote(yes: boolean) {
    setBusy(true);
    const ok = await insertHuman(
      yes
        ? "Yes, I'd like to proceed with the quoted terms."
        : "Not at this time — I'd like to think it over.",
      false,
    );
    if (ok && yes) {
      setAiError(null);
      setAiBusy(true);
      const res = await generateTermSheet(loanId);
      setAiBusy(false);
      if (!res.ok) setAiError(res.error ?? "Couldn't generate the term sheet.");
    }
    setBusy(false);
  }

  // Inline e-signature on the term sheet (records signer, time, IP).
  async function signTS() {
    setBusy(true);
    setAiError(null);
    const res = await signTermSheet(loanId);
    setBusy(false);
    if (!res.ok) setAiError(res.error ?? "Couldn't record the signature.");
  }

  async function ask() {
    const text = body.trim();
    if (!text) return;
    setAiError(null);
    // A lender's AI exchange is team-only (the answer may reference internal data);
    // a borrower's/originator's stays shared. The server marks the AI reply to match.
    const ok = await insertHuman(text, isLender);
    if (!ok) return;
    setBody("");
    setAiBusy(true);
    const res = await askAi(loanId, text);
    setAiBusy(false);
    if (!res.ok) setAiError(res.error ?? "The AI couldn't answer.");
    else await refreshMessages(); // pull in the AI reply (don't depend on realtime)
  }

  // The user confirmed the AI's proposed record changes. Apply them, then pull in the
  // confirmation message and refresh the server-rendered field values.
  async function applyUpdates(updates: ProposedUpdatesPayload) {
    setApplying(true);
    setAiError(null);
    const res = await applyLoanUpdates({ loanId, updates });
    setApplying(false);
    if (!res.ok) setAiError(res.error ?? "Couldn’t apply the changes.");
    await refreshMessages();
    router.refresh(); // reload the Loan Info values the change touched
  }

  // Declined — a short note moves the proposal off the last line so the card hides.
  async function cancelUpdates() {
    await insertHuman("Let’s not make that change.", isLender);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {messages.map((m, idx) => {
          const isAi = m.sender_kind === "ai";
          return (
            <div key={m.id}>
              <div className="mb-1 flex items-baseline gap-2 text-xs">
                <span className={`text-sm font-semibold ${isAi ? "text-navy" : "text-fg"}`}>
                  {roleLabel(m)}
                </span>
                {m.is_internal && (
                  <span className="status-pill status-update">Internal</span>
                )}
                <span className="text-faint">{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-fg">{m.body}</p>
              {m.payload?.doc && (
                <a
                  href={m.payload.doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card mt-2.5 inline-flex max-w-full items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface-2"
                >
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy/[0.06] text-navy">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-fg">{m.payload.doc.title}</span>
                    <span className="text-xs text-muted">PDF · opens in a new tab</span>
                  </span>
                </a>
              )}
              {m.payload?.form && intakeMode && idx === messages.length - 1 && (
                <IntakeFormCard
                  form={m.payload.form}
                  disabled={busy || aiBusy}
                  onSubmit={(values) => submitForm(m.payload!.form!.fields, values)}
                />
              )}
              {m.payload?.proceed && idx === messages.length - 1 && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => proceedQuote(true)}
                    disabled={busy || aiBusy}
                    className="btn btn-primary"
                  >
                    Yes, proceed
                  </button>
                  <button
                    type="button"
                    onClick={() => proceedQuote(false)}
                    disabled={busy || aiBusy}
                    className="btn btn-secondary"
                  >
                    Not now
                  </button>
                </div>
              )}
              {m.payload?.sign && idx === messages.length - 1 && (
                <button
                  type="button"
                  onClick={signTS}
                  disabled={busy || aiBusy}
                  className="btn btn-gold mt-3"
                >
                  Sign term sheet
                </button>
              )}
              {m.payload?.updates && idx === messages.length - 1 && (
                <div className="card mt-3 px-4 py-3">
                  <p className="text-sm font-semibold text-fg">Proposed changes</p>
                  <ul className="mt-2 space-y-1 text-[0.9375rem] text-fg">
                    {m.payload.updates.fields.map((f) => (
                      <li key={`f-${f.key}`} className="flex flex-wrap gap-x-2">
                        <span className="text-muted">{f.label}</span>
                        <span aria-hidden>→</span>
                        <span className="font-medium">{f.value}</span>
                      </li>
                    ))}
                    {m.payload.updates.stage && (
                      <li className="flex flex-wrap gap-x-2">
                        <span className="text-muted">Stage</span>
                        <span aria-hidden>→</span>
                        <span className="font-medium">{m.payload.updates.stage.label}</span>
                      </li>
                    )}
                    {m.payload.updates.checklist.map((c) => (
                      <li key={`c-${c.document}`} className="flex flex-wrap gap-x-2">
                        <span className="text-muted">{c.document}</span>
                        <span aria-hidden>→</span>
                        <span className="font-medium">{c.status.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyUpdates(m.payload!.updates!)}
                      disabled={applying || busy || aiBusy}
                      className="btn btn-primary"
                    >
                      {applying ? "Applying…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelUpdates}
                      disabled={applying || busy || aiBusy}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-line bg-surface px-6 py-4">
        {aiBusy && (
          <p className="mb-2 flex items-center gap-2 text-sm text-muted">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            {intakeMode ? "Setting up the loan…" : "AI System is thinking…"}
          </p>
        )}
        {aiError && (
          <p className="mb-2 text-sm" style={{ color: "var(--status-outstanding)" }}>
            {aiError}
          </p>
        )}
        {isLender && !intakeMode && (
          <label className="mb-2 flex w-fit items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              className="accent-navy"
            />
            Internal (team only)
          </label>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) send(e);
            }}
            rows={2}
            placeholder={intakeMode ? "Answer to continue setup…" : "Message the team, or ask the AI…"}
            className="field min-h-11 flex-1 resize-none"
          />
          {!intakeMode && (
            <button
              type="button"
              onClick={ask}
              disabled={aiBusy || busy}
              className="btn btn-secondary"
            >
              Ask AI
            </button>
          )}
          <button type="submit" disabled={busy || aiBusy} className="btn btn-primary">
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
