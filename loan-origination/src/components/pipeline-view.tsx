"use client";

import { useEffect, useState } from "react";
import { PipelineTable } from "./pipeline-table";
import { PipelineKanban } from "./pipeline-kanban";
import type { Loan } from "@/lib/types";

const VIEW_KEY = "sphinx.pipeline.view";

/** Pipeline with a Table / Board (Kanban) toggle; the choice is remembered per browser. */
export function PipelineView({
  loans,
  guarantors,
}: {
  loans: Loan[];
  guarantors: Record<string, string>;
}) {
  const [view, setView] = useState<"table" | "board">("table");

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "board" || v === "table") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView(v);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function pick(v: "table" | "board") {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex self-start rounded-md border border-line p-0.5 text-sm">
        {(["table", "board"] as const).map((v) => (
          <button
            key={v}
            onClick={() => pick(v)}
            className={`rounded px-3 py-1 font-medium capitalize ${
              view === v ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {v === "board" ? "Board" : "Table"}
          </button>
        ))}
      </div>
      {view === "table" ? (
        <PipelineTable loans={loans} guarantors={guarantors} />
      ) : (
        <PipelineKanban loans={loans} guarantors={guarantors} />
      )}
    </div>
  );
}
