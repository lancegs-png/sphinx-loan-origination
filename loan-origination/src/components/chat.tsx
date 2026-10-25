"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
}: {
  loanId: string;
  initialMessages: Message[];
  currentUserId: string;
  currentRole: string;
  isLender: boolean;
}) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
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

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        loan_id: loanId,
        sender_user_id: currentUserId,
        sender_kind: "human",
        sender_role: currentRole,
        is_internal: isLender ? internal : false,
        body: text,
      })
      .select("*")
      .single();
    setBusy(false);
    if (!error && data) {
      const m = data as Message;
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
      setBody("");
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {messages.map((m) => (
          <div key={m.id}>
            <div className="mb-1 flex items-baseline gap-2 text-sm text-muted">
              <span className="font-semibold text-fg">{roleLabel(m)}</span>
              {m.is_internal && (
                <span className="rounded border border-line px-1.5 text-xs">Internal</span>
              )}
              <span>{new Date(m.created_at).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-line px-6 py-4">
        {isLender && (
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
            placeholder="Type a message…"
            className="min-h-11 flex-1 resize-none rounded-md border border-line px-3 py-2.5 text-base"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-fg px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
