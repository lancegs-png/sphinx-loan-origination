"use client";

import { templatesForProgram, templateReadiness } from "@/lib/templates/registry";
import type { FieldValues } from "@/lib/types";

export function TemplatesPanel({
  loanId,
  programKey,
  values,
}: {
  loanId: string;
  programKey: string | null;
  values: FieldValues;
}) {
  // term_sheet_date / commitment_date are auto-stamped to the generation date when the
  // document is downloaded (defaulting to today), so they never block readiness.
  const AUTO_STAMPED = new Set(["term_sheet_date", "commitment_date"]);
  const hasValue = (k: string) => {
    if (AUTO_STAMPED.has(k)) return true;
    const c = values[k]?.current;
    return c !== undefined && c !== null && c !== "";
  };
  const templates = templatesForProgram(programKey);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Highlighted green when every required field is filled. Download anytime.
      </p>
      {templates.map((t) => {
        const { ready, missing } = templateReadiness(t, hasValue);
        return (
          <div
            key={t.id}
            className="card p-3.5"
            style={{
              borderColor: ready ? "var(--status-approved)" : "var(--line)",
              background: ready ? "color-mix(in srgb, var(--status-approved) 9%, transparent)" : undefined,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{t.name}</span>
              {t.generatable ? (
                <span className="flex shrink-0 gap-1.5">
                  <a
                    href={`/api/loans/${loanId}/template/${t.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary px-2.5 py-1 text-xs"
                  >
                    {t.format === "xlsx" ? "CSV" : t.format === "docx" ? "Word" : "Download"}
                  </a>
                  {t.format === "docx" && (
                    <a
                      href={`/api/loans/${loanId}/template/${t.id}?format=pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary px-2.5 py-1 text-xs"
                    >
                      PDF
                    </a>
                  )}
                </span>
              ) : (
                <span className="text-xs text-muted">soon</span>
              )}
            </div>
            <div
              className="mt-0.5 text-xs"
              style={{ color: ready ? "var(--status-approved)" : "var(--muted)" }}
            >
              {ready
                ? "Ready — all required fields present"
                : `${missing.length} field${missing.length === 1 ? "" : "s"} missing`}
            </div>
            {!ready && (
              <div className="mt-0.5 text-xs text-muted">
                Missing: {missing.slice(0, 6).join(", ")}
                {missing.length > 6 ? ` +${missing.length - 6} more` : ""}
              </div>
            )}
            {t.requiresVerified && (
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                Verified values required
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
