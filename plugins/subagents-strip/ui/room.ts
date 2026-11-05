// The room the list may open into: the space between the summary row and the
// top of the pane the strip sits in. bb gives a banner no measure of it, and
// a draft or attachments grow the composer, so the strip measures its own
// place in the page and keeps the result in `--sr-room`.

/**
 * Ref callback for the list's wrapper, whose bottom edge is the summary row's
 * top: keeps `--sr-room` current while it is mounted.
 */
export function trackRoomAbove(wrap: HTMLElement | null): (() => void) | undefined {
  // why: React's ref type allows null, though with a cleanup returned React 19 never passes it.
  if (!wrap) return;
  const pane = clippingAncestor(wrap);
  const measure = () => {
    const paneTop = pane ? pane.getBoundingClientRect().top : 0; // no pane: the viewport's top
    wrap.style.setProperty("--sr-room", `${wrap.getBoundingClientRect().bottom - paneTop}px`);
  };
  measure();
  // why: anything that moves the summary row (the composer growing, the pane resizing) resizes one of these.
  const observer = new ResizeObserver(measure);
  for (const el of ancestorsUpTo(wrap, pane)) observer.observe(el);
  return () => observer.disconnect();
}

// ---------------------------------------------------------------- layer 2

/** The nearest ancestor that scrolls or clips: the pane the list must stay inside. */
function clippingAncestor(el: HTMLElement): HTMLElement | null {
  for (let a = el.parentElement; a; a = a.parentElement) if (getComputedStyle(a).overflowY !== "visible") return a;
  return null;
}

/** The element's ancestors up to and including `last`; all of them when it is null. */
function ancestorsUpTo(el: HTMLElement, last: HTMLElement | null): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (let a = el.parentElement; a; a = a.parentElement) {
    chain.push(a);
    if (a === last) break;
  }
  return chain;
}
