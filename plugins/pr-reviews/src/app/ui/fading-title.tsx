// Activity's row title: text that doesn't fit fades out at its end, never cut to "…", and under the
// pointer on its `.pr-reviews-title-scope` it runs through to its end (app.css). Measured whenever
// its box resizes. Color and size are the caller's.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** The fade at a title's end, which its last words run past to read crisp. */
const FADE = 24;
/** How fast a title runs under the pointer, in px a second: slow enough to read as it moves. */
const RUN_SPEED = 45;

export function FadingTitle({ text, className }: { text: string; className: string }) {
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
    <span ref={ref} className={`pr-reviews-title ${className}`} data-over={over > 0 || undefined} style={over > 0 ? runStyle(over) : undefined}>
      <span className="pr-reviews-title-text">{text}</span>
    </span>
  );
}

/** How far the title runs (its overflow and the fade) and for how long, for app.css. */
function runStyle(over: number): CSSProperties & Record<"--pr-reviews-travel" | "--pr-reviews-run", string> {
  const travel = over + FADE;
  return { "--pr-reviews-travel": `${travel}px`, "--pr-reviews-run": `${Math.round((travel / RUN_SPEED) * 1000)}ms` };
}
