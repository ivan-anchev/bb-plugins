// Text that doesn't fit fades at its end, never cut to "…", and runs through to its end under the
// pointer: boat-sandbox's FadingTitle (src/app/home/fading-title.tsx), copied so the cards read alike.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** The fade at the text's end, which its last words run past to read crisp. */
const FADE = 24;
/** How fast the text runs under the pointer, in px a second: slow enough to read as it moves. */
const RUN_SPEED = 45;

/** Measured whenever its box resizes. */
export function FadingText({ text, className }: { text: string; className: string }) {
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
    <span ref={ref} className={`nt-fade ${className}`} data-over={over > 0 || undefined} style={over > 0 ? runStyle(over) : undefined}>
      <span className="nt-fade-text">{text}</span>
    </span>
  );
}

/** How far the text runs (its overflow and the fade) and for how long, for `.nt-fade-text`. */
function runStyle(over: number): CSSProperties & Record<"--nt-travel" | "--nt-run", string> {
  const travel = over + FADE;
  return { "--nt-travel": `${travel}px`, "--nt-run": `${Math.round((travel / RUN_SPEED) * 1000)}ms` };
}
