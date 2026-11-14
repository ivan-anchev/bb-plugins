// One line of the activity, as the fold reads it: a muted glyph in the gutter, then its sentence in
// muted grey and " · 8d ago". A line that folds items is a button that opens them in place under
// it, each with its clock time, and keeps focus as they open; the fold eases open and closes
// quicker, at once under reduced motion. Names draw as the sentence does: no weight, no colour.
import { useId, type ReactNode, type RefCallback } from "react";
import { experimental_Icon as Icon, UrlLink } from "@get-bb/plugin-sdk/app";
import { shortSha } from "../../contract.ts";
import type { Label } from "../../github/label.ts";
import { MERGED } from "../page/pr-header.tsx";
import { daysAgo } from "../relative-time.ts";
import { timeOfLine, type ActivityLine } from "./activity-fold.ts";
import { ActivityGlyph, glyphOf } from "./activity-glyph.tsx";
import { wordsOf, type FoldItem, type Word } from "./activity-words.ts";

type LineProps = {
  /** Holds focus, without being a tab stop, for the form of a review it replaced (activity-timeline.tsx). */
  ref?: RefCallback<HTMLElement>;
  line: ActivityLine;
  /** What the line opens to, or null for a line that does not open. */
  fold: ReactNode;
  open: boolean;
  onToggle(): void;
};

export function Line({ ref, line, fold, open, onToggle }: LineProps) {
  const foldId = useId();
  const words = (
    <>
      <span className={`grid h-5 place-items-center ${GLYPH_TONES[line.kind] ?? "text-subtle-foreground"}`}>
        <ActivityGlyph name={glyphOf(line)} />
      </span>
      <span className="min-w-0">
        <Words words={wordsOf(line)} />
        {" "}
        <span className="whitespace-nowrap text-subtle-foreground">
          {"· "}
          <LineTime at={timeOfLine(line)} />
          {fold !== null && <Icon name="ChevronRight" aria-hidden className={`ml-1 inline size-3.5 align-[-3px] transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />}
        </span>
      </span>
    </>
  );
  if (fold === null) {
    return (
      <div ref={ref} tabIndex={ref === undefined ? undefined : -1} className={`${LINE} rounded-md ${FOCUS_RING}`}>
        {words}
      </div>
    );
  }
  return (
    <>
      <button ref={ref} type="button" aria-expanded={open} aria-controls={foldId} onClick={onToggle} className={`${LINE} w-full cursor-pointer rounded-md text-left transition-colors duration-150 ease-out hover:text-foreground hover:duration-0 ${FOCUS_RING}`}>
        {words}
      </button>
      <div
        id={foldId}
        inert={!open}
        className={`grid motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)]" : "grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-[160ms] ease-in"}`}
      >
        <div className="min-h-0 overflow-hidden">{fold}</div>
      </div>
    </>
  );
}

// Only the opening and the merge keep their colour.
const GLYPH_TONES: Partial<Record<ActivityLine["kind"], string>> = { opened: "text-success-foreground", merged: MERGED };

const LINE = "grid min-h-9 grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 py-2 text-[13px] leading-5 text-muted-foreground";

const FOCUS_RING = "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

/** A folded line's items: each one's words and its clock time, under the line's words. */
export function FoldItems({ items }: { items: FoldItem[] }) {
  return (
    <ul className="grid pb-1.5">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-x-3 py-[3px] text-[12.5px] leading-5 text-muted-foreground">
          <span className="col-start-2 min-w-0">
            <Words words={item.words} />
          </span>
          <time dateTime={item.at} title={new Date(item.at).toLocaleString()} className="text-subtle-foreground tabular-nums">
            {new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        </li>
      ))}
    </ul>
  );
}

/** "8d ago", with the date and time on hover. */
function LineTime({ at }: { at: string }) {
  return (
    <time dateTime={at} title={new Date(at).toLocaleString()}>
      {daysAgo(at, Date.now())}
    </time>
  );
}

function Words({ words }: { words: Word[] }) {
  return words.map((word, index) => <WordView key={index} word={word} />);
}

function WordView({ word }: { word: Word }): ReactNode {
  if (typeof word === "string") return word;
  switch (word.kind) {
    case "sha": {
      const sha = <span className={`${MONO} text-subtle-foreground`}>{shortSha(word.sha)}</span>;
      return word.url === null ? (
        sha
      ) : (
        <UrlLink href={word.url} className={LINK}>
          {sha}
        </UrlLink>
      );
    }
    case "code":
      return <span className={MONO}>{word.text}</span>;
    case "label":
      return <LabelName label={word.label} />;
    case "title":
      return <span className="text-foreground">{word.text}</span>;
    case "link":
      return (
        <UrlLink href={word.url} className={`text-foreground ${LINK}`}>
          {word.text}
        </UrlLink>
      );
    default:
      return word satisfies never;
  }
}

const MONO = "font-mono text-[11.5px] leading-none";

const LINK = "rounded-sm decoration-foreground/35 underline-offset-[3px] hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

// The label's own colour as a dot, as the side panel's chips show it.
function LabelName({ label }: { label: Label }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span aria-hidden className="size-[7px] shrink-0 self-center rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
    </span>
  );
}
