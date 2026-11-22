const ROWS = '[data-testid="app-page-header-content-row"], [data-testid="thread-secondary-panel-top-chrome"] > [role="toolbar"]';
const CONTROLS = '[data-testid="app-window-title-bar"], [data-testid="app-sidebar-trigger-overlay"]';
const SPACER = ".ht-inset";
const CLEARANCE = 12;
const PADDING = /(^|:)pl-/;
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
  let measured: Element[] | null = null;
  let inset: ChromeInset | null = null;
  const publish = (next: ChromeInset) => {
    if (inset !== null && same(inset, next)) return;
    inset = next;
    onChange(next);
  };
  const readRows = () => {
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
