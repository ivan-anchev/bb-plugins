import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AboveComposer(props: { children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const column = pageColumn(anchorRef.current!);
    const node = document.createElement("div");
    node.className = "oq-slot";
    column.prepend(node);
    setSlot(node);
    return () => node.remove();
  }, []);

  return (
    <>
      <span ref={anchorRef} hidden />
      {slot !== null && createPortal(props.children, slot)}
    </>
  );
}

function pageColumn(anchor: HTMLElement): HTMLElement {
  const column = anchor.closest("section")?.parentElement?.parentElement;
  if (!column) throw new Error("Office Quote: bb's homepage layout changed; no column above the sections.");
  return column;
}
