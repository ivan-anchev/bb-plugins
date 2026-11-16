// why: bb pads the row at the window's top-left (a page header's row, or the right panel's view bar when it
// sits there) to clear its floating chrome: the sidebar toggle, back and forward, and on bb Desktop the macOS
// traffic lights. The strip now holds the window's top row, so the inset moves to the strip: a spacer at its
// start wears that row's own padding and transition classes, so bb's CSS sizes it for every state (sidebar
// open, closed or a rail; full screen or not) and animates it with the row. app.css drops the row's own
// inset while the strip shows. Nothing here decides the inset; bb's classes do.

/** The rows bb pads at the window's top-left. */
const ROWS = '[data-testid="app-page-header-content-row"], [data-testid="thread-secondary-panel-top-chrome"] > [role="toolbar"]';
/** A Tailwind left-padding token, with any variants (`max-md:pointer-coarse:pl-[40px]`). */
const PADDING = /(^|:)pl-/;
/** The tokens that size and animate the inset: left padding and the transition (`motion-reduce:transition-none`). */
const INSET = /(^|:)(pl-|transition|duration-|ease-)/;

/**
 * Hands `onChange` the inset classes of the row that owns the window's top-left, and again whenever bb
 * changes that row's classes, until `signal` aborts. Call `follow()` after bb adds or removes elements, so the
 * watch moves to the rows bb shows now.
 */
export function followChromeInset(signal: AbortSignal, onChange: (classes: string) => void): { follow(): void } {
  let rows: Element[] = [];
  let source: Element | null = null;
  let classes: string | null = null;
  const read = () => {
    // why keep the source without padding: a row losing its inset (the sidebar opening) still carries the
    // transition that animates the inset away. With no row at all (the single-pane New thread screen has no
    // header) the last inset stays, as bb's floating chrome is still there.
    source = rows.find((row) => tokens(row, PADDING) !== "") ?? (source !== null && rows.includes(source) ? source : (rows[0] ?? source));
    const next = source === null ? "" : tokens(source, INSET);
    if (next === classes) return;
    classes = next;
    onChange(next);
  };
  const observer = new MutationObserver(read);
  signal.addEventListener("abort", () => observer.disconnect());
  return {
    follow(): void {
      if (signal.aborted) return;
      const next = Array.from(document.querySelectorAll(ROWS));
      if (next.length !== rows.length || next.some((row, index) => row !== rows[index])) {
        observer.disconnect();
        next.forEach((row) => observer.observe(row, { attributes: true, attributeFilter: ["class"] }));
        rows = next;
      }
      read();
    },
  };
}

function tokens(row: Element, pattern: RegExp): string {
  return Array.from(row.classList)
    .filter((token) => pattern.test(token))
    .join(" ");
}
