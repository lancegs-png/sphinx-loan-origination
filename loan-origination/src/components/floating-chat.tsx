"use client";

import { useState } from "react";
import { Chat } from "./chat";
import type { Message } from "@/lib/types";

/**
 * A dockable chat popup available from every tab, so the deal can be updated by
 * talking to the agent without leaving the current view. The <Chat> stays mounted
 * (only its container's visibility toggles) so the thread survives open/close and
 * tab switches. `dormant` hides the whole widget on the full Chat tab, where the
 * tab's own chat is already on screen.
 */
export function FloatingChat({
  dormant,
  loanId,
  initialMessages,
  currentUserId,
  currentRole,
  isLender,
  intakeMode,
}: {
  dormant: boolean;
  loanId: string;
  initialMessages: Message[];
  currentUserId: string;
  currentRole: string;
  isLender: boolean;
  intakeMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const show = open && !dormant;

  return (
    <>
      {!dormant && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn btn-primary fixed bottom-5 right-5 z-40 rounded-full px-4 shadow-lg"
          aria-label="Open chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Chat
        </button>
      )}

      <div
        className={`fixed bottom-5 right-5 z-40 flex h-[70vh] max-h-[640px] w-[min(26rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl ${
          show ? "" : "hidden"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
          <span className="text-sm font-semibold text-fg">Deal chat</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted transition-colors hover:text-fg"
            aria-label="Close chat"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <Chat
          loanId={loanId}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
          currentRole={currentRole}
          isLender={isLender}
          intakeMode={intakeMode}
        />
      </div>
    </>
  );
}
