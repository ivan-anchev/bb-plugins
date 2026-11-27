// Text in an issue's feed cut to a few lines while it runs longer: a machine line to one, a decision
// or a comment to three, a decision's whole first sentence however long. Cut, it is a button that
// opens it whole, and closes it again; text that fits is plain text, with nothing to press. A press
// on a link in it is the link's alone, and a link focused in it opens it, so focus never rests on a
// link the cut hides. Screen readers read it whole either way: the cut is only drawn.
import { useLayoutEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

/** `whole`: the part of the drawn text the cut never hides, as a decision's first sentence (null: none yet); none given, the cut is `lines` alone. */
type ClampProps = { lines: 1 | 3; whole?: (text: HTMLElement) => Range | null; className: string; children: ReactNode };

export function Clamp({ lines, whole, className, children }: ClampProps) {
  const [text, setText] = useState<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const { cut, shown } = useCut(text, lines, whole);
  const body = (
    <span ref={setText} className={`rmi-clamp ${className}`} style={linesStyle(shown)} data-open={open || undefined}>
      {children}
    </span>
  );
  if (!cut) return body;
  return (
    <button type="button" className="rmi-clamp-press" aria-expanded={open} onClick={(event) => onLink(event) || setOpen(!open)} onFocus={(event) => event.target === event.currentTarget || setOpen(true)}>
      {body}
    </button>
  );
}

/**
 * The lines the shut text shows, `lines` or as many as its `whole` part runs over, and whether the
 * text runs past them, measured whenever its box resizes. why only while shut: open, it fits, and it
 * must stay pressable to close. why an effect, and the lines set on the box before the cut is read:
 * both are the browser's layout, and the cut depends on the lines.
 */
function useCut(text: HTMLElement | null, lines: ClampProps["lines"], whole: ClampProps["whole"]): { cut: boolean; shown: number } {
  const [cut, setCut] = useState(false);
  const [shown, setShown] = useState<number>(lines);
  useLayoutEffect(() => {
    if (text === null) return;
    const measure = () => {
      if (text.dataset.open !== undefined) return;
      const fold = foldLines(text, lines, whole);
      text.style.setProperty("--rmi-lines", String(fold));
      setShown(fold);
      setCut(text.scrollHeight > text.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [text, lines, whole]);
  return { cut, shown };
}

/** The lines the shut text shows: `lines`, or as many as its `whole` part runs over. */
function foldLines(text: HTMLElement, lines: ClampProps["lines"], whole: ClampProps["whole"]): number {
  const kept = whole === undefined ? null : whole(text);
  return kept === null ? lines : Math.max(lines, linesOf(kept));
}

/**
 * How many lines `range` runs over, as drawn: one per run of its boxes stacked down the page. why by
 * a box's middle: a box on the same line, as code's padded one, can reach a little past its line.
 */
function linesOf(range: Range): number {
  let lines = 0;
  let lineFoot = -Infinity;
  for (const box of [...range.getClientRects()].sort((a, b) => a.top - b.top)) {
    const below = box.top + box.height / 2 > lineFoot;
    if (below) lines += 1;
    lineFoot = below ? box.bottom : Math.max(lineFoot, box.bottom);
  }
  return lines;
}

/** Whether the press was on a link in the text, as in its Markdown, which follows it instead. */
const onLink = (event: MouseEvent): boolean => event.target instanceof Element && event.target.closest("a[href]") !== null;

const linesStyle = (lines: number): CSSProperties & Record<"--rmi-lines", number> => ({ "--rmi-lines": lines });
