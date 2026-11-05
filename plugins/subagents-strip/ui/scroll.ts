// Ref callbacks for boxes whose content can outgrow them: an expanded row's
// body and its clamped report. They read layout the browser owns, so they
// observe it rather than guess it from line counts.
// why: React's ref type allows null, though with a cleanup returned React 19 never passes it.

/** Keeps `data-overflow` on the element while its content is taller than its box. */
export function markOverflow(el: HTMLElement | null): (() => void) | undefined {
  return el ? watchOverflow(el) : undefined;
}

/**
 * For a settled scroll body, which leads with its outcome: marks overflow, and
 * starts at the top, including the moment a followed tail settles.
 */
export function startAtTop(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return;
  el.scrollTop = 0;
  return watchOverflow(el);
}

/**
 * For a scroll body that follows a live tail: marks overflow as above, starts
 * at the bottom, and stays there as content is appended while the reader is at
 * the bottom. Content that grows above the end, such as revealed history,
 * keeps the reader's place instead. Either way, leaving the bottom stops the
 * follow until they scroll back down.
 */
export function followTail(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return;
  const unwatch = watchOverflow(el);
  let atBottom = true;
  let end = lastElement(el);
  const onScroll = () => {
    atBottom = isAtBottom(el);
  };
  const onChange = () => {
    const last = lastElement(el);
    const appended = last !== end;
    end = last;
    if (appended && atBottom) el.scrollTop = el.scrollHeight;
    else atBottom = isAtBottom(el);
  };
  el.scrollTop = el.scrollHeight;
  el.addEventListener("scroll", onScroll, { passive: true });
  // why: new steps change the content, not the capped box, so watch the DOM, not the size.
  const observer = new MutationObserver(onChange);
  observer.observe(el, { childList: true, subtree: true });
  return () => {
    unwatch();
    observer.disconnect();
    el.removeEventListener("scroll", onScroll);
  };
}

// ---------------------------------------------------------------- layer 2

function watchOverflow(el: HTMLElement): () => void {
  // why: scrollHeight rounds to whole pixels, so content a fraction taller is not an overflow.
  const mark = () => el.toggleAttribute("data-overflow", el.scrollHeight > el.clientHeight + 1);
  mark();
  // why: a capped box resizes as it fills up to its cap and as it drops below it, which is when the mark can flip.
  const observer = new ResizeObserver(mark);
  observer.observe(el);
  return () => observer.disconnect();
}

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
}

/** The deepest last element: a new one means something arrived at the end, not above it. */
function lastElement(el: Element): Element {
  let last = el;
  while (last.lastElementChild) last = last.lastElementChild;
  return last;
}
