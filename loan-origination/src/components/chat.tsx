"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { askAi, intakeTurn } from "@/app/actions";
import { IntakeFormCard } from "@/components/intake-form-card";
import type { Message } from "@/lib/types";

function roleLabel(m: Message): string {
  if (m.sender_kind === "ai") return "AI record keeper";
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
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const channel = supabase
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

    return () => {
      supabase.removeChannel(channel);
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
    // The AI reply arrives via realtime.
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {messages.map((m, idx) => (
          <div key={m.id}>
            <div className="mb-1 flex items-baseline gap-2 text-sm text-muted">
              <span className="font-semibold text-fg">{roleLabel(m)}</span>
              {m.is_internal && (
                <span className="rounded border border-line px-1.5 text-xs">Internal</span>
              )}
              <span>{new Date(m.created_at).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
            {m.payload?.form && intakeMode && idx === messages.length - 1 && (
              <IntakeFormCard
                form={m.payload.form}
                disabled={busy || aiBusy}
                onSubmit={(values) => submitForm(m.payload!.form!.fields, values)}
              />
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-line px-6 py-4">
        {aiBusy && (
          <p className="mb-2 text-sm text-muted">
            {intakeMode ? "Setting up the loan…" : "AI record keeper is thinking…"}
          </p>
        )}
        {aiError && (
          <p className="mb-2 text-sm" style={{ color: "var(--status-outstanding)" }}>
            {aiError}
          </p>
        )}
        {isLender && !intakeMode && (
          <label className="mb-2 flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            Internal (team only)
          </label>
        )}
        <div className="flex items-end gap-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) send(e);
            }}
            rows={2}
            placeholder={intakeMode ? "Answer to continue setup…" : "Message the team, or ask the AI…"}
            className="min-h-11 flex-1 resize-none rounded-md border border-line px-3 py-2.5 text-base"
          />
          {!intakeMode && (
            <button
              type="button"
              onClick={ask}
              disabled={aiBusy || busy}
              className="rounded-md border border-line px-4 py-2.5 font-medium disabled:opacity-50"
            >
              Ask AI
            </button>
          )}
          <button
            type="submit"
            disabled={busy || aiBusy}
            className="rounded-md bg-fg px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
