// When a hover card shows, as Activity Sidebar decides it (src/card/card-intent.ts): the pointer
// resting on its trigger for half a second opens its card, or keyboard focus on it at once; once one
// is open, or within a moment of one closing, another trigger's opens at once. The card stays while
// the pointer is on its trigger or on the card, or focus is on its trigger; once both have left it
// closes after a beat. Escape closes it wherever focus is, and holds bb's own Escape, which would
// leave the page. A press puts it away, and the focus the press gives a trigger opens none. No timer
// outlives its owner. A board row is a trigger (use-hover-card.ts), and so is an issue link in chat
// (chat-links/link-card.ts); `Key` names one.
import { useEffect, useMemo, useState } from "react";

/** What the pointer and focus tell the card. */
export type CardIntent<Key> = {
  enter(key: Key): void;
  leave(key: Key): void;
  focus(key: Key): void;
  blur(key: Key): void;
  /** A press: the card goes, and the focus it gives a trigger in the same moment opens none. */
  press(): void;
  close(): void;
};

/** The trigger whose card shows (null: none), and the intent to tell what the pointer and focus do. */
export function useCardIntent<Key>(): { shown: Key | null; intent: CardIntent<Key> } {
  const [shown, setShown] = useState<Key | null>(null);
  const intent = useMemo(() => cardIntent<Key>(setShown), []);
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
  return { shown, intent };
}

// ------------------------------------------------------------------ layer 2

/** How long the pointer rests on a trigger before its card opens. */
const OPEN_DELAY = 500;
/** How long after the pointer and focus leave before the card closes: time to cross onto it. */
const CLOSE_DELAY = 150;
/** How long after a card closes that the next opens at once. */
const WARM = 400;

/** The timers and facts behind which card shows, told to `show` as they change. */
function cardIntent<Key>(show: (key: Key | null) => void): CardIntent<Key> & { stop(): void } {
  let shown: Key | null = null;
  let hovered: Key | null = null;
  let focused: Key | null = null;
  let closedAt = -Infinity;
  let pressing = false;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  let pressed: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(opening);
    clearTimeout(closing);
  };
  const open = (key: Key) => {
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
  /** Closes the card after a beat, unless the pointer or focus is still on its trigger. */
  const settle = (key: Key) => {
    if (shown !== key || hovered === key || focused === key) return;
    clearTimeout(closing);
    closing = setTimeout(close, CLOSE_DELAY);
  };
  const warm = () => shown !== null || performance.now() - closedAt < WARM;

  return {
    enter(key) {
      hovered = key;
      if (shown === key) return cancel();
      clearTimeout(opening);
      if (warm()) open(key);
      else opening = setTimeout(() => open(key), OPEN_DELAY);
    },
    leave(key) {
      if (hovered === key) hovered = null;
      clearTimeout(opening);
      settle(key);
    },
    focus(key) {
      if (pressing) return;
      focused = key;
      open(key);
    },
    blur(key) {
      if (focused === key) focused = null;
      settle(key);
    },
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
