// Draws its children above bb's new-thread composer. bb's only homepage slot sits under the
// composer, so this registers a homepage section, hides it, and moves its content into a node
// placed in front of the composer in the same column: the composer and every card below shift
// down. Tied to the section, so it exists only while the homepage is open.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AboveComposer(props: { children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // why an effect: bb's DOM is outside React's reach; the node is added and removed with the section.
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

// section → bb's stack of homepage sections → the page column, whose first child is the composer.
function pageColumn(anchor: HTMLElement): HTMLElement {
  const column = anchor.closest("section")?.parentElement?.parentElement;
  if (!column) throw new Error("Office Quote: bb's homepage layout changed; no column above the sections.");
  return column;
}
