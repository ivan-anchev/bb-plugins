// why: bb's composer focuses itself as it mounts (bb 0.49's composer plugin asks for an animation frame once
// its editor exists, then focuses it). A tab's panes mount together, so the caret lands in the last pane's
// composer, not in the focused pane's that bb marks, routes to and names in the URL; bb's own reload does the
// same, and no write order avoids it. Nothing on the focus tells bb's apart from another script's or assistive
// tech's; only its timing does: it lands in the first animation frame after the composer mounts (measured: 144 of
// 144 mounts, also at 6× CPU throttling). So from a show until every pane's composer is past that frame, a
// composer's focus in that frame is put back where focus belongs, in the same focus event so no keystroke lands
// between: where the user last moved focus, else the focused pane's composer. Every other focus move (a pointer,
// the keyboard, assistive tech, another script) is left alone.
import { PANE } from "../screen.ts";
import { readStored } from "./stored-layout.ts";

const COMPOSER = `[${PANE}] [data-promptbox] [contenteditable="true"]`;
/** bb's composer skips focusing itself on a coarse pointer, a touch screen. */
const COARSE_POINTER = "(pointer: coarse)";
/** A backstop for a pane that never gets a composer, such as one whose thread fails to load. */
const BACKSTOP_MS = 10_000;

type Focusable = Element & HTMLOrSVGElement;

/** The last show's correction; the next show takes over from it. */
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
  /** Animation frames since the show started. Asked for before bb mounts anything, each runs before bb's focus. */
  let frame = 0;
  /** Composers on screen before the show: bb focused them already. */
  const earlier = new WeakSet(composers());
  /** The frame bb focuses each composer it mounts in: the first frame after the mount, when we first see it. */
  const autofocusFrame = new WeakMap<Element, number>();
  /** Composers that bb's focus reached, in that frame; a later focus there is someone else's. */
  const autofocused = new WeakSet<Element>();
  /** Where focus was last moved other than by bb's composers. */
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

  /** Whether the pane's composer is one bb mounted during the show, and past the frame it focuses it in. */
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

/** The composer of the pane bb marks focused, once it has one. */
function focusedComposer(): HTMLElement | null {
  const focusedPaneId = readStored()?.focusedPaneId;
  const pane = panes().find((pane) => pane.getAttribute(PANE) === focusedPaneId);
  return pane?.querySelector<HTMLElement>(COMPOSER) ?? null;
}

/** HTML and SVG elements can take focus; the DOM types the focused element as neither. */
function canFocus(element: Element): element is Focusable {
  return "focus" in element;
}
