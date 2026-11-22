import type { InDraft } from "../../contract.ts";

/** The briefs this window has seen in one composer's draft. */
export type SeenBriefs = ReadonlySet<InDraft["brief"]>;

/**
 * `text`, the draft now; `waiting`, the drafts notes wait in, this composer's own. Returns the
 * briefs seen in the draft now, and the ones seen before that it no longer holds. A brief no
 * longer waiting is forgotten, so judging again with the same inputs finds nothing more gone.
 */
export function judgeDraft(seen: SeenBriefs, text: string, waiting: readonly InDraft[]): { seen: SeenBriefs; gone: InDraft[] } {
  const held = waiting.filter(({ brief }) => text.includes(brief));
  const gone = waiting.filter(({ brief }) => seen.has(brief) && !text.includes(brief));
  return { seen: new Set(held.map(({ brief }) => brief)), gone };
}
