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

const FADE = 24;
const RUN_SPEED = 45;

function runStyle(over: number): CSSProperties & Record<"--rmi-travel" | "--rmi-run", string> {
  const travel = over + FADE;
  return { "--rmi-travel": `${travel}px`, "--rmi-run": `${Math.round((travel / RUN_SPEED) * 1000)}ms` };
}
