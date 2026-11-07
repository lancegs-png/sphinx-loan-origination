import { STAGES, stageIndex } from "@/lib/stages";

/**
 * Stage progress: completed = navy, current = gold (filled + ring),
 * upcoming = hollow. Wraps cleanly; no decorative connectors.
 */
export function StageBar({ currentStage }: { currentStage: string }) {
  const current = stageIndex(currentStage);

  return (
    <ol className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {STAGES.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className={
                state === "current"
                  ? "h-2.5 w-2.5 rounded-full bg-gold ring-4 ring-gold/20"
                  : state === "done"
                    ? "h-2.5 w-2.5 rounded-full bg-navy"
                    : "h-2.5 w-2.5 rounded-full border-[1.5px] border-line-strong bg-surface"
              }
            />
            <span
              className={
                state === "current"
                  ? "text-sm font-semibold text-navy"
                  : state === "done"
                    ? "text-sm text-muted"
                    : "text-sm text-faint"
              }
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
