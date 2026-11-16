// why: bb pads the row at the window's top-left (a page header's row, or the right panel's view bar when it
// sits there) to clear its floating chrome: the sidebar toggle, back and forward, and on bb Desktop the macOS
// traffic lights. The strip now holds the window's top row, so the inset moves to the strip: a spacer at its
// start wears that row's own padding and transition classes, so bb's CSS sizes it for every state (sidebar
// open, closed or a rail; full screen or not) and animates it with the row. app.css drops the row's own
// inset while the strip shows. Where bb pads a row, nothing here decides the inset; bb's classes do.
//
// why measure on a screen with no such row (the single-pane New thread screen has no header): bb computes no
// inset there, but its floating controls still float over the strip. Their classes don't change with the
// sidebar, so only their right edge says where they end, and the spacer reaches past it. The strip resizes
// on every frame of bb's sidebar slide, so the measure follows the slide in step. The measure is the
// spacer's padding, as bb's classes are, so moving to a header animates bb's padding transition from the
// measured value, not from none.

/** The rows bb pads at the window's top-left. */
const ROWS = '[data-testid="app-page-header-content-row"], [data-testid="thread-secondary-panel-top-chrome"] > [role="toolbar"]';
/**
 * bb's floating controls at the window's top-left wherever the strip shows: on bb Desktop for macOS the title
 * bar's (back, forward, the sidebar toggle, beside the traffic lights); on the web and bb Desktop for Windows
 * and Linux the sidebar toggle. (bb's third, `app-desktop-sidebar-trigger`, is macOS at compact widths only,
 * where app.css hides the strip.)
 */
const CONTROLS = '[data-testid="app-window-title-bar"], [data-testid="app-sidebar-trigger-overlay"]';
/** The strip's inset spacer (src/ui/strip.tsx); a window has one strip. */
const SPACER = ".ht-inset";
/** Room between bb's floating controls and the strip's first control, as bb leaves after them on Desktop. */
const CLEARANCE = 12;
/** A Tailwind left-padding token, with any variants (`max-md:pointer-coarse:pl-[40px]`). */
const PADDING = /(^|:)pl-/;
/** The tokens that size and animate the inset: left padding and the transition (`motion-reduce:transition-none`). */
const INSET = /(^|:)(pl-|transition|duration-|ease-)/;

/** The strip's inset spacer: bb's classes from the row it pads, or the left padding that clears its floating controls. */
export type ChromeInset = { classes: string } | { padding: number };

/**
 * Hands `onChange` the strip's inset, and again whenever it changes, until `signal` aborts. Call `follow()`
 * after bb adds or removes elements, so the watch moves to the rows, controls and strip on the page now.
 */
export function followChromeInset(signal: AbortSignal, onChange: (inset: ChromeInset) => void): { follow(): void } {
  let rows: Element[] = [];
  let source: Element | undefined;
  let spacer: Element | null = null;
  let controls: Element[] = [];
  /** The strip and controls being measured; null while a row gives the inset. */
  let measured: Element[] | null = null;
  let inset: ChromeInset | null = null;
  const publish = (next: ChromeInset) => {
    if (inset !== null && same(inset, next)) return;
    inset = next;
    onChange(next);
  };
  const readRows = () => {
    // why keep the source without padding: a row losing its inset (the sidebar opening) still carries the
    // transition that animates the inset away.
    source = rows.find((row) => tokens(row, PADDING) !== "") ?? rows.find((row) => row === source) ?? rows[0];
    publish({ classes: source === undefined ? "" : tokens(source, INSET) });
  };
  const measure = () => {
    if (spacer === null) return;
    const end = Math.max(0, ...controls.map((control) => control.getBoundingClientRect().right));
    publish({ padding: Math.max(0, Math.ceil(end + CLEARANCE - spacer.getBoundingClientRect().left)) });
  };
  const classes = new MutationObserver(readRows);
  const geometry = new ResizeObserver(measure);
  signal.addEventListener("abort", () => {
    classes.disconnect();
    geometry.disconnect();
  });
  return {
    follow(): void {
      if (signal.aborted) return;
      const nextRows = Array.from(document.querySelectorAll(ROWS));
      if (!sameElements(nextRows, rows)) {
        classes.disconnect();
        nextRows.forEach((row) => classes.observe(row, { attributes: true, attributeFilter: ["class"] }));
        rows = nextRows;
      }
      if (rows.length > 0) {
        geometry.disconnect();
        measured = null;
        readRows();
        return;
      }
      spacer = document.querySelector(SPACER);
      controls = Array.from(document.querySelectorAll(CONTROLS));
      // why observe the strip: it resizes when bb's sidebar moves it. why the border box: bb's controls change
      // their padding (the traffic-light reserve), not their content. A new target reports once on observe,
      // which measures.
      const strip = spacer?.parentElement;
      const next = strip ? [strip, ...controls] : controls;
      if (measured === null || !sameElements(next, measured)) {
        geometry.disconnect();
        next.forEach((target) => geometry.observe(target, { box: "border-box" }));
        measured = next;
      }
    },
  };
}

function same(a: ChromeInset, b: ChromeInset): boolean {
  return "classes" in a ? "classes" in b && a.classes === b.classes : "padding" in b && a.padding === b.padding;
}

function sameElements(a: Element[], b: Element[]): boolean {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}

function tokens(row: Element, pattern: RegExp): string {
  return Array.from(row.classList)
    .filter((token) => pattern.test(token))
    .join(" ");
}
