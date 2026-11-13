"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setLoanStage } from "@/app/actions";
import { STAGES } from "@/lib/stages";
import type { Loan } from "@/lib/types";

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function closeDate(d: string | null | undefined) {
  if (!d) return null;
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(d);
}

/**
 * Kanban board of the pipeline: one column per stage, a card per loan. Drag a card to
 * another column to move the deal to that stage (setLoanStage). Moves are optimistic and
 * revert on failure. Clicking a card (without dragging) opens the loan.
 */
export function PipelineKanban({
  loans,
  guarantors,
}: {
  loans: Loan[];
  guarantors: Record<string, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Loan[]>(loans);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Re-sync when the server data changes (e.g. after a move's router.refresh) — adjust
  // state during render rather than in an effect (the loans reference is stable across the
  // board's own optimistic updates, so this only fires on genuine new server data).
  const [syncedLoans, setSyncedLoans] = useState<Loan[]>(loans);
  if (syncedLoans !== loans) {
    setSyncedLoans(loans);
    setItems(loans);
  }

  async function move(id: string, stage: string) {
    const loan = items.find((l) => l.id === id);
    if (!loan || loan.stage === stage) return;
    const prev = loan.stage;
    setItems((cur) => cur.map((l) => (l.id === id ? { ...l, stage } : l)));
    setMsg(null);
    const res = await setLoanStage({ loanId: id, stage });
    if (!res.ok) {
      setItems((cur) => cur.map((l) => (l.id === id ? { ...l, stage: prev } : l)));
      setMsg(res.error ?? "Could not move the deal.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {msg && <p className="text-sm text-[var(--status-outstanding)]">{msg}</p>}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: "min-content" }}>
          {STAGES.map((s) => {
            const col = items.filter((l) => l.stage === s.key);
            return (
              <div
                key={s.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(s.key);
                }}
                onDragLeave={() => setOverStage((d) => (d === s.key ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverStage(null);
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  if (id) void move(id, s.key);
                  setDragId(null);
                }}
                className={`flex w-[16rem] shrink-0 flex-col rounded-lg border p-2 ${
                  overStage === s.key ? "border-gold bg-gold/5" : "border-line bg-surface-2"
                }`}
              >
                <div className="flex items-center justify-between px-1 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {s.label}
                  </span>
                  <span className="text-[11px] font-medium text-muted">{col.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {col.map((l) => {
                    const close = closeDate(l.closing_date);
                    const guarantor = guarantors[l.id];
                    return (
                      <div
                        key={l.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", l.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(l.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        role="button"
                        tabIndex={0}
                        onClick={() => router.push(`/loans/${l.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") router.push(`/loans/${l.id}`);
                        }}
                        className={`card cursor-pointer p-3 text-sm transition-shadow hover:shadow-md ${
                          dragId === l.id ? "opacity-50" : ""
                        }`}
                      >
                        <div className="font-medium text-fg">{l.property_address ?? "—"}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-medium tabular-nums text-muted">
                            {l.loan_number ?? l.opportunity_number}
                          </span>
                          {!l.loan_number && <span className="chip">Opportunity</span>}
                        </div>
                        <div className="mt-1.5 font-medium tabular-nums text-fg">
                          {money(l.loan_amount)}
                        </div>
                        {(l.borrower_name || guarantor) && (
                          <div className="mt-1 truncate text-xs text-muted">
                            {l.borrower_name ?? guarantor}
                          </div>
                        )}
                        <div className="mt-1 flex items-center justify-between text-xs text-muted">
                          <span>{l.loan_type ?? "—"}</span>
                          {close && <span className="tabular-nums">Close {close}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {col.length === 0 && (
                    <div className="rounded-md border border-dashed border-line px-2 py-6 text-center text-[11px] text-muted">
                      Drop here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
