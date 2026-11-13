"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { STAGES, stageLabel, stageIndex } from "@/lib/stages";
import type { Loan } from "@/lib/types";

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// Close date as MM/DD/YYYY (month-day-year). Keeps the stored YYYY-MM-DD if it doesn't parse.
function closeDate(d: string | null | undefined) {
  if (!d) return "—";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(d);
}

type ColKey = "property" | "borrower" | "guarantor" | "amount" | "type" | "stage" | "close";

const ALL_COLS: { key: ColKey; label: string; align?: "right" }[] = [
  { key: "property", label: "Property" },
  { key: "borrower", label: "Borrower" },
  { key: "guarantor", label: "Guarantor" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "type", label: "Type" },
  { key: "stage", label: "Stage" },
  { key: "close", label: "Close" },
];

// Bumped to v2 so the new Guarantor column shows for viewers who saved v1 preferences.
const STORAGE_KEY = "sphinx.pipeline.cols.v2";
const DEFAULT_VISIBLE: Record<ColKey, boolean> = {
  property: true,
  borrower: true,
  guarantor: true,
  amount: true,
  type: true,
  stage: true,
  close: true,
};

export function PipelineTable({
  loans,
  guarantors,
}: {
  loans: Loan[];
  guarantors: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [type, setType] = useState("");
  const [visible, setVisible] = useState<Record<ColKey, boolean>>(DEFAULT_VISIBLE);
  const colMenuRef = useRef<HTMLDetailsElement>(null);

  // Close the column menu on outside click / Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = colMenuRef.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && colMenuRef.current) colMenuRef.current.open = false;
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Load saved column preferences (per-viewer convenience).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // One-time read of a persisted preference after mount (kept out of the
      // initial render to avoid a hydration mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setVisible({ ...DEFAULT_VISIBLE, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCol(key: ColKey) {
    setVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const types = useMemo(
    () => Array.from(new Set(loans.map((l) => l.loan_type).filter(Boolean))) as string[],
    [loans],
  );

  const stagesPresent = useMemo(() => {
    const present = new Set(loans.map((l) => l.stage));
    return STAGES.filter((s) => present.has(s.key));
  }, [loans]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return loans.filter((l) => {
      if (stage && l.stage !== stage) return false;
      if (type && l.loan_type !== type) return false;
      if (!q) return true;
      const hay = [l.loan_number, l.opportunity_number, l.property_address, l.borrower_name, guarantors[l.id]]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [loans, query, stage, type, guarantors]);

  // Default order: latest stage first (Post-Close → … → Intake), newest-first within a
  // stage (the incoming order is created_at desc, and the sort is stable).
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage)),
    [filtered],
  );

  const shownCols = ALL_COLS.filter((c) => visible[c.key]);
  const hasFilters = query.trim() !== "" || stage !== "" || type !== "";

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar — compact, grouped to the right */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search loans"
          className="field field-sm search w-full sm:w-52"
        />
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          aria-label="Filter by stage"
          className="field field-sm select w-auto"
        >
          <option value="">All stages</option>
          {stagesPresent.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {types.length > 0 && (
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by type"
            className="field field-sm select w-auto"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStage("");
                setType("");
              }}
              className="btn btn-ghost btn-sm"
            >
              Clear
            </button>
          )}
          <details ref={colMenuRef} className="relative">
            <summary className="btn btn-secondary btn-sm cursor-pointer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              Columns
            </summary>
            <div className="menu absolute right-0 mt-2">
              {ALL_COLS.map((c) => (
                <label key={c.key} className="menu-item">
                  <input
                    type="checkbox"
                    checked={visible[c.key]}
                    onChange={() => toggleCol(c.key)}
                    className="accent-navy"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-semibold">Loan</th>
                {shownCols.map((c) => (
                  <th
                    key={c.key}
                    className={`px-5 py-3 font-semibold ${c.align === "right" ? "text-right" : ""}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={shownCols.length + 1} className="px-5 py-14 text-center text-muted">
                    No loans match your filters.
                  </td>
                </tr>
              ) : (
                sorted.map((l) => (
                  <tr
                    key={l.id}
                    className="group border-b border-line last:border-0 transition-colors hover:bg-surface-2/60"
                  >
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/loans/${l.id}`}
                        className="font-semibold text-navy decoration-gold/50 underline-offset-2 group-hover:underline"
                      >
                        {l.loan_number ?? l.opportunity_number}
                      </Link>
                      {!l.loan_number && <span className="chip ml-2">Opportunity</span>}
                    </td>
                    {shownCols.map((c) => (
                      <td
                        key={c.key}
                        className={`px-5 py-3.5 ${c.align === "right" ? "text-right" : ""}`}
                      >
                        {c.key === "property" && <span className="text-fg">{l.property_address ?? "—"}</span>}
                        {c.key === "borrower" && <span className="text-fg">{l.borrower_name ?? "—"}</span>}
                        {c.key === "guarantor" && <span className="text-fg">{guarantors[l.id] ?? "—"}</span>}
                        {c.key === "amount" && (
                          <span className="font-medium tabular-nums text-fg">{money(l.loan_amount)}</span>
                        )}
                        {c.key === "type" && <span className="text-muted">{l.loan_type ?? "—"}</span>}
                        {c.key === "stage" && (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap text-fg">
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
                            {stageLabel(l.stage)}
                          </span>
                        )}
                        {c.key === "close" && (
                          <span className="tabular-nums whitespace-nowrap text-muted">{closeDate(l.closing_date)}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted">
        Showing {filtered.length} of {loans.length} {loans.length === 1 ? "deal" : "deals"}
      </p>
    </div>
  );
}
