// Activity Sidebar's fading title (src/ui/row/row.tsx FadingTitle), copied since plugins cannot import
// each other: text that doesn't fit fades out at its end, never cut to "…", measured whenever its box
// resizes. It carries how far it runs past its box, so a row's title can run through to its end under
// the pointer (issue-board.css `.rmi-text`).
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export function FadingText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setOver(Math.max(0, el.scrollWidth - el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span ref={ref} className="rmi-text" data-over={over > 0 || undefined} style={over > 0 ? runStyle(over) : undefined}>
      <span className="rmi-text-run">{text}</span>
    </span>
  );
}

/** The fade at a title's end, which its last words run past to read crisp. */
const FADE = 24;
/** How fast a title runs under the pointer, in px a second: slow enough to read as it moves. */
const RUN_SPEED = 45;

/** How far the title runs (its overflow and the fade) and for how long, for `.rmi-text-run`. */
function runStyle(over: number): CSSProperties & Record<"--rmi-travel" | "--rmi-run", string> {
  const travel = over + FADE;
  return { "--rmi-travel": `${travel}px`, "--rmi-run": `${Math.round((travel / RUN_SPEED) * 1000)}ms` };
}
