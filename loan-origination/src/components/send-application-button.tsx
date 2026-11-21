"use client";

import { useState } from "react";
import { sendBorrowerApplication } from "@/app/actions";

/**
 * Lending-team button on a loan: generates (or reuses) the borrower's per-loan application link and
 * emails it to them. Shown once the term sheet is signed.
 */
export function SendApplicationButton({ loanId }: { loanId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await sendBorrowerApplication(loanId);
    setBusy(false);
    if (res.ok) setMsg("Application sent to the borrower");
    else setErr(res.error ?? "Could not send the application");
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-green-600">{msg}</span>}
      {err && <span className="text-xs text-red-600">{err}</span>}
      <button type="button" className="btn btn-ghost text-sm" onClick={send} disabled={busy}>
        {busy ? "Sending…" : "Send application"}
      </button>
    </div>
  );
}
