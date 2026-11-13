"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openLoan } from "@/app/actions";

type Kind = "opportunity" | "loan";

const KINDS: { key: Kind; title: string; blurb: string }[] = [
  { key: "opportunity", title: "Opportunity", blurb: "OPP number now, SPHX at signing. Starts in the Opportunity stage." },
  { key: "loan", title: "Loan", blurb: "Assigns the SPHX number now and goes straight into Processing." },
];

export function NewDealButton({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("opportunity");
  const [address, setAddress] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  // Focus the address field when the dialog opens; close on Escape.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => addressRef.current?.focus(), 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  function reset() {
    setKind("opportunity");
    setAddress("");
    setFirst("");
    setLast("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await openLoan({ address, guarantorFirst: first, guarantorLast: last, kind });
    if (res.ok && res.id) {
      router.push(`/loans/${res.id}`);
      return; // leave the dialog up (busy) through the navigation
    }
    setBusy(false);
    setError(res.error ?? "Could not open the deal.");
  }

  return (
    <>
      <button type="button" className={className ?? "btn btn-primary"} onClick={() => { reset(); setOpen(true); }}>
        <span aria-hidden className="-ml-0.5 text-base leading-none">+</span>
        New loan
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
          onMouseDown={() => !busy && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-deal-title"
            className="card w-full max-w-md p-6"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="new-deal-title" className="text-lg font-bold text-fg">New deal</h2>
            <p className="mt-1 text-sm text-muted">Set up the Drive folder, dashboard, and checklist in one step.</p>

            <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
              {/* Opportunity vs Loan */}
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Deal type">
                {KINDS.map((k) => {
                  const active = kind === k.key;
                  return (
                    <button
                      type="button"
                      key={k.key}
                      role="radio"
                      aria-checked={active}
                      onClick={() => setKind(k.key)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        active ? "border-navy bg-surface-2 ring-1 ring-navy" : "border-line hover:bg-surface-2/60"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-fg">{k.title}</span>
                      <span className="mt-1 block text-xs leading-snug text-muted">{k.blurb}</span>
                    </button>
                  );
                })}
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">Property address</span>
                <input
                  ref={addressRef}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, City, ST 12345"
                  className="field"
                  required
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted">Borrower first name</span>
                  <input value={first} onChange={(e) => setFirst(e.target.value)} className="field" placeholder="Optional" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted">Borrower last name</span>
                  <input value={last} onChange={(e) => setLast(e.target.value)} className="field" placeholder="Optional" />
                </label>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="mt-1 flex items-center justify-end gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !address.trim()}>
                  {busy ? "Opening…" : kind === "loan" ? "Open loan" : "Open opportunity"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
