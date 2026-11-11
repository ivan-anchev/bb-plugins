// The lines selected in one diff, and the one comment box under them or in one of its review
// threads. Pure transitions; the hook in use-line-selection.ts holds the state and wires the
// diff's gestures and the box's actions.
import type { SelectedLineRange } from "@pierre/diffs";

/** What a request did: the posted comment or reply, a sent question, or a comment or reply added to the reader's pending review. */
export type BoxOutcome = { kind: "commented"; url: string } | { kind: "asked" } | { kind: "reviewed" };

/**
 * `writing`: the box holds the draft. `sent` is a request that went while the reader changed the
 * draft: the box says it went and keeps the changed text, which is still unsent. `done`: the
 * draft that went was the draft, so the box shows the outcome where the text was.
 */
export type BoxStage = { kind: "writing"; sent: BoxOutcome | null } | { kind: "done"; outcome: BoxOutcome };

/**
 * Where the diff's one box is, and what its text goes to.
 *
 * `lines`: under lines, to ask about them or comment on them. `at` is the diff's own report of the
 * lines, kept as is so the highlight is exactly what the reader picked; it becomes rows only where
 * it is read (line-span.ts). `finding` is the finding whose button opened the box, while the box
 * is still on that finding's line. `lit`: whether its lines are highlighted. A box that is done,
 * or whose lines the reader deselected while it held a draft, stays where it is with nothing
 * highlighted.
 *
 * `reply`: in the review thread `threadId`, under its comments, to reply to it. It highlights nothing.
 */
export type BoxPlace = { kind: "lines"; at: SelectedLineRange; finding: number | null; lit: boolean } | { kind: "reply"; threadId: string };

/** The diff's one box. `opened` changes every time the box opens, so it is drawn afresh and takes focus. */
export type LineBox = BoxPlace & { opened: number; stage: BoxStage };

/**
 * `picking`: the lines of a press or a drag still in progress. The box stays where it is until
 * the reader lets go, so a drag never runs into rows that moved under it. `draft` follows the box
 * from lines to lines.
 */
export type DiffLines = { picking: SelectedLineRange | null; box: LineBox | null; draft: string };

export const NO_LINES: DiffLines = { picking: null, box: null, draft: "" };

/** The lines Pierre highlights: those being picked, else the box's while they are lit. */
export const highlightOf = ({ picking, box }: DiffLines): SelectedLineRange | null => picking ?? (box?.kind === "lines" && box.lit ? box.at : null);

/** Each step of a press, a shift-click or a drag. */
export function linesPicking(lines: DiffLines, range: SelectedLineRange | null): DiffLines {
  return sameRange(lines.picking, range) ? lines : { ...lines, picking: range };
}

/**
 * The reader let go. The box opens under the picked lines with the draft, or stays when they are
 * its own. A gesture that cleared the lines (pressing the one selected line) closes an empty box;
 * a box holding a draft stays, so a draft is only ever discarded on purpose.
 */
export function linesPicked(lines: DiffLines, range: SelectedLineRange | null): DiffLines {
  const { box } = lines;
  if (range === null) {
    if (isBlank(lines.draft)) return NO_LINES;
    return { ...lines, picking: null, box: box && unlit(box) };
  }
  if (box?.kind === "lines" && box.stage.kind === "writing" && box.lit && sameRange(box.at, range)) return lines.picking === null ? lines : { ...lines, picking: null };
  return { ...lines, picking: null, box: openAt(box, { kind: "lines", at: range, finding: null, lit: true }) };
}

/**
 * A finding's button: its line is selected and the box opens under it. `prefill` fills only an
 * empty draft, so a draft the reader is writing is never replaced.
 */
export function openedFromFinding(lines: DiffLines, range: SelectedLineRange, finding: number, prefill: string): DiffLines {
  return { picking: null, box: openAt(lines.box, { kind: "lines", at: range, finding, lit: true }), draft: isBlank(lines.draft) ? prefill : lines.draft };
}

/**
 * Reply, or Quote reply, in a review thread: the box opens under its comments. `quote` goes after
 * any draft, as on GitHub, so a draft the reader is writing is never replaced.
 */
export function openedForReply(lines: DiffLines, threadId: string, quote: string): DiffLines {
  return { picking: null, box: openAt(lines.box, { kind: "reply", threadId }), draft: withQuote(lines.draft, quote) };
}

/** A draft with a quote ("" for none) after it, as GitHub's Quote reply adds one. */
export const withQuote = (draft: string, quote: string) => (isBlank(draft) ? quote : quote === "" ? draft : `${draft.trimEnd()}\n\n${quote}`);

/**
 * A request went with `sent`. If that is still the draft, the box is done: it shows the outcome
 * and its lines are no longer selected. A draft changed while it went is unsent, so the box stays
 * open with it, and says the request went.
 */
export function settled(lines: DiffLines, outcome: BoxOutcome, sent: string): DiffLines {
  const { box } = lines;
  if (box === null) return lines;
  const stage = stageAfter(lines.draft, outcome, sent);
  if (stage.kind === "writing") return { ...lines, box: { ...box, stage } };
  return { ...lines, box: { ...unlit(box), stage }, draft: "" };
}

/** A request went with `sent`: done if that is still the draft, else still writing, saying it went. */
export const stageAfter = (draft: string, outcome: BoxOutcome, sent: string): BoxStage => (draft === sent ? { kind: "done", outcome } : { kind: "writing", sent: outcome });

export const isBlank = (text: string) => text.trim() === "";

/** A box with nothing sent yet. */
export const WRITING: BoxStage = { kind: "writing", sent: null };

function openAt(box: LineBox | null, place: BoxPlace): LineBox {
  return { ...place, opened: (box?.opened ?? 0) + 1, stage: WRITING };
}

const unlit = (box: LineBox): LineBox => (box.kind === "lines" ? { ...box, lit: false } : box);

// The ranges Pierre reports are built one way (`endSide` only when it differs from `side`), so
// equal ranges have equal fields.
function sameRange(a: SelectedLineRange | null, b: SelectedLineRange | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end && a.side === b.side && a.endSide === b.endSide;
}
