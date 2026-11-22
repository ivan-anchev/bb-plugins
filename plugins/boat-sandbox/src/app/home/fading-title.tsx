import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const FADE = 24;
const RUN_SPEED = 45;

/** Measured whenever its box resizes. */
export function FadingTitle({ text }: { text: string }) {
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
    <span ref={ref} className="bs-title" data-over={over > 0 || undefined} style={over > 0 ? runStyle(over) : undefined}>
      <span className="bs-title-text">{text}</span>
    </span>
  );
}

function runStyle(over: number): CSSProperties & Record<"--bs-travel" | "--bs-run", string> {
  const travel = over + FADE;
  return { "--bs-travel": `${travel}px`, "--bs-run": `${Math.round((travel / RUN_SPEED) * 1000)}ms` };
}
