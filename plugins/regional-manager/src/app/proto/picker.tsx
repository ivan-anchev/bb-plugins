// PROTOTYPE (i7), throwaway: emil-prototype's picker (PICKER.md), in React. The bottom one switches
// variants and owns the keys (1–N, ←/→); the top one switches screens.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type PickerProps = { label: string; names: readonly string[]; active: number; onSelect(index: number): void; position?: "top"; keys?: boolean };

export function Picker({ label, names, active, onSelect, position, keys = false }: PickerProps) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [highlight, setHighlight] = useState({ width: 0, x: 0 });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const item = items.current[active];
      if (item) setHighlight({ width: item.offsetWidth, x: item.offsetLeft });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, names]);

  // Enable the slide only after first paint, so load doesn't animate.
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!keys) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= names.length) onSelect(number - 1);
      else if (event.key === "ArrowRight") onSelect((active + 1) % names.length);
      else if (event.key === "ArrowLeft") onSelect((active - 1 + names.length) % names.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keys, active, names.length, onSelect]);

  return (
    <nav className="proto-picker" aria-label={label} data-position={position} data-ready={ready || undefined}>
      <span className="proto-picker-highlight" aria-hidden="true" style={{ width: highlight.width, transform: `translateX(${highlight.x}px)` }} />
      {names.map((name, index) => (
        <button
          key={name}
          type="button"
          ref={(item) => {
            items.current[index] = item;
          }}
          className="proto-picker-item"
          data-active={index === active || undefined}
          aria-current={index === active ? "true" : undefined}
          onClick={() => onSelect(index)}
        >
          {name}
        </button>
      ))}
    </nav>
  );
}
