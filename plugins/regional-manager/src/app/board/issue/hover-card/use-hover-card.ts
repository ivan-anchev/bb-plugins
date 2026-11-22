// Which row's hover card shows on the board, as Activity Sidebar decides it (src/card/card-intent.ts):
// the pointer resting on a row for half a second opens its card, or keyboard focus on it at once;
// once one is open, or within a moment of one closing, another row's opens at once. The card stays
// while the pointer is on its row or on the card (which sits in the row's box, joined to it with no
// gap: hover-card.css), or focus is on its row; once both have left it closes after a beat. Escape
// closes it wherever focus is, and holds bb's own Escape, which would leave the page. A press puts it
// away, and the focus the press gives a row opens none. A touch has no hover: its tap opens the
// issue. No timer outlives the board.
import { useEffect, useMemo, useState, type FocusEvent, type HTMLAttributes, type PointerEvent } from "react";

type HoverCards = {
  /** The key of the row whose card shows; null: none. */
  shown: string | null;
  /** On a row's box: the pointer and focus events that open and close its card. */
  trigger(key: string): HTMLAttributes<HTMLDivElement>;
  /** On the board: a press puts the card away. */
  board: HTMLAttributes<HTMLDivElement>;
};

export function useHoverCards(): HoverCards {
  const [shown, setShown] = useState<string | null>(null);
  const intent = useMemo(() => cardIntent(setShown), []);
  useEffect(() => () => intent.stop(), [intent]);
  useEffect(() => {
    if (shown === null) return;
    // why the document, bubbling: what has focus acts on Escape first, and bb's, on the window, after; it skips an Escape whose default was prevented.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      intent.close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, intent]);
  return {
    shown,
    trigger: (key) => ({
      onPointerEnter: (event: PointerEvent) => {
        if (event.pointerType !== "touch") intent.enter(key);
      },
      onPointerLeave: () => intent.leave(key),
      // why: focus moving between the row and its pull request stays on the row, and doesn't bring back a card Escape closed.
      onFocus: (event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) intent.focus(key);
      },
      onBlur: (event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) intent.blur(key);
      },
    }),
    // why not on the card: it holds words to select, and nothing to press.
    board: {
      onPointerDownCapture: (event: PointerEvent) => {
        if (!(event.target instanceof Element && event.target.closest(".rmi-card") !== null)) intent.press();
      },
    },
  };
}

// ------------------------------------------------------------------ layer 2

/** How long the pointer rests on a row before its card opens. */
const OPEN_DELAY = 500;
/** How long after the pointer and focus leave before the card closes: time to cross onto it. */
const CLOSE_DELAY = 150;
/** How long after a card closes that the next opens at once. */
const WARM = 400;

/** The timers and facts behind which card shows, told to `show` as they change. */
function cardIntent(show: (key: string | null) => void) {
  let shown: string | null = null;
  let hovered: string | null = null;
  let focused: string | null = null;
  let closedAt = -Infinity;
  let pressing = false;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  let pressed: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(opening);
    clearTimeout(closing);
  };
  const open = (key: string) => {
    cancel();
    shown = key;
    show(key);
  };
  const close = () => {
    cancel();
    if (shown === null) return;
    shown = null;
    closedAt = performance.now();
    show(null);
  };
  /** Closes the card after a beat, unless the pointer or focus is still on its row. */
  const settle = (key: string) => {
    if (shown !== key || hovered === key || focused === key) return;
    clearTimeout(closing);
    closing = setTimeout(close, CLOSE_DELAY);
  };
  const warm = () => shown !== null || performance.now() - closedAt < WARM;

  return {
    enter(key: string) {
      hovered = key;
      if (shown === key) return cancel();
      clearTimeout(opening);
      if (warm()) open(key);
      else opening = setTimeout(() => open(key), OPEN_DELAY);
    },
    leave(key: string) {
      if (hovered === key) hovered = null;
      clearTimeout(opening);
      settle(key);
    },
    focus(key: string) {
      if (pressing) return;
      focused = key;
      open(key);
    },
    blur(key: string) {
      if (focused === key) focused = null;
      settle(key);
    },
    /** A press: the card goes, and the focus it gives a row in the same moment opens none. */
    press() {
      pressing = true;
      clearTimeout(pressed);
      // why a task later: the press's focus comes in the same task as the press.
      pressed = setTimeout(() => (pressing = false));
      close();
    },
    close,
    stop() {
      cancel();
      clearTimeout(pressed);
    },
  };
}
