// How a `+A −D` stat looks wherever the PR page shows one: each part in its tone's color.
import type { StatPart } from "./change-stats.ts";

export const TONE_CLASSES: Record<StatPart["tone"], string> = {
  added: "text-diff-added",
  removed: "text-diff-removed",
  muted: "text-muted-foreground",
};

/** The parts in order, a space apart, on one line. */
export function StatText({ parts }: { parts: readonly StatPart[] }) {
  return (
    <span className="whitespace-nowrap">
      {parts.map((part, index) => (
        // Keyed by place: two parts can share a tone, as two muted zeros do.
        <span key={index}>
          {index === 0 ? null : " "}
          <span className={TONE_CLASSES[part.tone]}>{part.text}</span>
        </span>
      ))}
    </span>
  );
}
