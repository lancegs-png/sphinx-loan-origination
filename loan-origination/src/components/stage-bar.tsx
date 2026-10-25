import { STAGES, stageIndex } from "@/lib/stages";

/**
 * Single-accent stage progress bar (design §12.1):
 * completed = solid black, current = bright accent, upcoming = grey.
 */
export function StageBar({ currentStage }: { currentStage: string }) {
  const current = stageIndex(currentStage);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {STAGES.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        const color =
          state === "current" ? "var(--accent)" : state === "done" ? "var(--fg)" : "var(--muted)";
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: state === "upcoming" ? "transparent" : color,
                border: `2px solid ${color}`,
              }}
            />
            <span
              className="text-sm"
              style={{
                color,
                fontWeight: state === "current" ? 700 : 500,
              }}
            >
              {s.label}
            </span>
            {i < STAGES.length - 1 && <span className="mx-1 text-line">—</span>}
          </li>
        );
      })}
    </ol>
  );
}
