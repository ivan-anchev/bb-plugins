/**
 * Ref callback for the list's wrapper, whose bottom edge is the summary row's
 * top: keeps `--sr-room` current while it is mounted.
 */
export function trackRoomAbove(wrap: HTMLElement | null): (() => void) | undefined {
  if (!wrap) return;
  const pane = clippingAncestor(wrap);
  let room = -Infinity;
  const measure = () => {
    const paneTop = pane ? pane.getBoundingClientRect().top : 0;
    const next = wrap.getBoundingClientRect().bottom - paneTop;
    if (Math.abs(next - room) < 1) return;
    room = next;
    wrap.style.setProperty("--sr-room", `${room}px`);
  };
  measure();
  const observer = new ResizeObserver(measure);
  for (const el of ancestorsUpTo(wrap, pane)) observer.observe(el);
  return () => observer.disconnect();
}

function clippingAncestor(el: HTMLElement): HTMLElement | null {
  for (let a = el.parentElement; a; a = a.parentElement) if (getComputedStyle(a).overflowY !== "visible") return a;
  return null;
}

function ancestorsUpTo(el: HTMLElement, last: HTMLElement | null): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (let a = el.parentElement; a; a = a.parentElement) {
    chain.push(a);
    if (a === last) break;
  }
  return chain;
}
