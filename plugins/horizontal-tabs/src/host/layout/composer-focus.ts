// WARNING: bb's composer focuses itself in the first animation frame after it mounts (measured 144 of 144 mounts, also at 6x CPU throttling, bb 0.49); re-measure when bb's composer changes.
import { PANE } from "../screen.ts";
import { readStored } from "./stored-layout.ts";

const COMPOSER = `[${PANE}] [data-promptbox] [contenteditable="true"]`;
const COARSE_POINTER = "(pointer: coarse)";
const BACKSTOP_MS = 10_000;

type Focusable = Element & HTMLOrSVGElement;

let last = new AbortController();

/**
 * Runs `show`, keeping each composer bb mounts from taking focus on its own, from now until every pane on screen
 * has a composer past the frame bb focuses it in (or BACKSTOP_MS after `show` settles), the next show starts, or
 * `signal` aborts.
 */
export async function withCaretInFocusedPane<T>(show: () => Promise<T>, signal: AbortSignal): Promise<T> {
  last.abort();
  if (matchMedia(COARSE_POINTER).matches) return show();
  const ended = new AbortController();
  last = ended;
  const until = AbortSignal.any([signal, ended.signal]);
  let frame = 0;
  const earlier = new WeakSet(composers());
  const autofocusFrame = new WeakMap<Element, number>();
  const autofocused = new WeakSet<Element>();
  let userFocus: Element | null = null;
  let moving = false;
  let shown = false;

  function moveTo(element: Focusable): void {
    moving = true;
    try {
      element.focus({ preventScroll: true });
    } finally {
      moving = false;
    }
  }

  function pastAutofocus(pane: Element): boolean {
    const composer = pane.querySelector(COMPOSER);
    return composer !== null && (autofocusFrame.get(composer) ?? Infinity) < frame;
  }

  function onFrame(): void {
    frame += 1;
    for (const composer of composers()) {
      if (!earlier.has(composer) && !autofocusFrame.has(composer)) autofocusFrame.set(composer, frame);
    }
    if (shown && panes().every(pastAutofocus)) ended.abort();
    else request = requestAnimationFrame(onFrame);
  }

  let request = requestAnimationFrame(onFrame);
  until.addEventListener("abort", () => cancelAnimationFrame(request), { once: true });

  document.addEventListener(
    "focusin",
    (event) => {
      const target = document.activeElement;
      if (moving || target === null) return;
      if (autofocusFrame.get(target) !== frame || autofocused.has(target)) {
        userFocus = target;
        return;
      }
      autofocused.add(target);
      const home = event.relatedTarget !== null && event.relatedTarget === userFocus ? userFocus : focusedComposer();
      if (home !== null && home !== target && canFocus(home)) moveTo(home);
    },
    { capture: true, signal: until },
  );
  try {
    return await show();
  } finally {
    shown = true;
    if (!until.aborted) {
      const backstop = setTimeout(() => ended.abort(), BACKSTOP_MS);
      until.addEventListener("abort", () => clearTimeout(backstop), { once: true });
    }
  }
}

function panes(): Element[] {
  return Array.from(document.querySelectorAll(`[${PANE}]`));
}

function composers(): Element[] {
  return Array.from(document.querySelectorAll(COMPOSER));
}

function focusedComposer(): HTMLElement | null {
  const focusedPaneId = readStored()?.focusedPaneId;
  const pane = panes().find((pane) => pane.getAttribute(PANE) === focusedPaneId);
  return pane?.querySelector<HTMLElement>(COMPOSER) ?? null;
}

function canFocus(element: Element): element is Focusable {
  return "focus" in element;
}
