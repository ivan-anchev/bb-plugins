// Text in an issue's feed cut to a few lines while it runs longer: a machine line to one, a decision's
// rest to two, a comment to three. Cut, it is a button that opens it whole, and closes it again; text
// that fits is plain text, with nothing to press. Screen readers read it whole either way: the cut is
// only drawn.
import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";

type ClampProps = { lines: 1 | 2 | 3; className: string; children: ReactNode };

export function Clamp({ lines, className, children }: ClampProps) {
  const [text, setText] = useState<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const cut = useCut(text);
  const body = (
    <span ref={setText} className={`rmi-clamp ${className}`} style={linesStyle(lines)} data-open={open || undefined}>
      {children}
    </span>
  );
  if (!cut) return body;
  return (
    <button type="button" className="rmi-clamp-press" aria-expanded={open} onClick={() => setOpen(!open)}>
      {body}
    </button>
  );
}

/**
 * Whether the text runs past its lines, measured whenever its box resizes. why only while shut: open,
 * it fits, and it must stay pressable to close. why an effect: the cut is the browser's layout.
 */
function useCut(text: HTMLElement | null): boolean {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    if (text === null) return;
    const measure = () => {
      if (text.dataset.open === undefined) setCut(text.scrollHeight > text.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [text]);
  return cut;
}

const linesStyle = (lines: ClampProps["lines"]): CSSProperties & Record<"--rmi-lines", number> => ({ "--rmi-lines": lines });
