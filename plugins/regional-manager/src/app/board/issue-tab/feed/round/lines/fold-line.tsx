// A line of an open round that opens on press to its detail, under it (round-body.tsx): a finding, a
// failed criterion, a blocking defect, or a note on the round with more to say than its row holds. One row, Activity Sidebar's: its hover wash and focus ring. A
// line with a hover card (finding-lines.tsx) shows it on hover and focus, by the board's card intent
// (use-hover-card.ts); the card is in the line's box, so the pointer on the card is on the line. why
// the detail stays in the page while folded: the button names what it controls.
import "./lines.css";
import { useId, useState, type HTMLAttributes, type ReactNode } from "react";
import { ResultGlyph } from "../result-glyph.tsx";

type FoldLineProps = {
  /** What the line shows, on one row. */
  line: ReactNode;
  detail: ReactNode;
  /** Its hover card: the card while it shows (null: it doesn't), its id, and the pointer and focus events on the line's box that show it. */
  card?: { element: ReactNode | null; id: string; trigger: HTMLAttributes<HTMLDivElement>; close(): void };
};

export function FoldLine({ line, detail, card }: FoldLineProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  // why the card goes on a press: the detail opens under the line, where the card sits.
  const press = () => {
    card?.close();
    setOpen(!open);
  };
  const described = card !== undefined && card.element !== null ? card.id : undefined;
  return (
    <li className="rmi-fold">
      <div className="rmi-fold-box" {...card?.trigger}>
        <button type="button" className="rmi-fold-row" aria-expanded={open} aria-controls={detailId} aria-describedby={described} onClick={press}>
          {line}
        </button>
        {card?.element}
      </div>
      <div id={detailId} className="rmi-fold-detail" hidden={!open}>
        {detail}
      </div>
    </li>
  );
}

/** What a note line says of the round: that it failed, that something warns, or neither. */
type Tone = "failed" | "warning" | null;

/**
 * A line that tells of the round rather than of a finding: its checkout, CI, a verdict or review
 * that never came. One row, its headline cut to it in its tone's colour and glyph; with `detail`, it
 * opens on press to the whole of what was said, else it is no button.
 */
export function NoteLine({ tone, headline, detail }: { tone: Tone; headline: string; detail: ReactNode | null }) {
  const line = (
    <>
      {tone !== null && <ResultGlyph result={tone === "failed" ? "fail" : "unverifiable"} />}
      <span className="rmi-line-title rmi-note-text" data-tone={tone ?? undefined}>
        {headline}
      </span>
    </>
  );
  if (detail !== null) return <FoldLine line={line} detail={detail} />;
  return (
    <li className="rmi-fold">
      <p className="rmi-fold-row" data-static>
        {line}
      </p>
    </li>
  );
}
