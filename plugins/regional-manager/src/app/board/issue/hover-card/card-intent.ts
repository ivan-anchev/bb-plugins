// When a hover card shows, as Activity Sidebar decides it (src/card/card-intent.ts): the pointer
// resting on its trigger for half a second opens its card, or keyboard focus on it at once; once one
// is open, or within a moment of one closing, another trigger's opens at once, but never in place of
// the card of the trigger that has focus while it shows (REVIEW.md). The card stays while
// the pointer is on its trigger or on the card, or focus is on its trigger; once both have left it
// closes after a beat. Escape closes it wherever focus is, while the card is on screen (hover-card.tsx
// holds it). A press puts it away, and the focus the press gives a trigger opens none. No timer
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
  /** What the card of `key` tells the intent while it is mounted (hover-card.tsx). */
  presence(key: Key): CardPresence;
};

/**
 * A mounted card's line to its intent: Escape puts it away, and it is on screen from `mounted()` until
 * the function that returns is called. A card that leaves the screen while its trigger still counts
 * as shown, as when bb renders its link again or its row goes, puts the intent's state away with it.
 */
export type CardPresence = { close(): void; mounted(): () => void };

/** The trigger whose card shows (null: none), and the intent to tell what the pointer and focus do. */
export function useCardIntent<Key>(): { shown: Key | null; intent: CardIntent<Key> } {
  const [shown, setShown] = useState<Key | null>(null);
  const intent = useMemo(() => cardIntent<Key>(setShown), []);
  useEffect(() => () => intent.stop(), [intent]);
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
  /** The trigger whose card is mounted: only a card on screen holds focus against the pointer, or keeps the next card warm. */
  let onScreen: Key | null = null;
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
  const warm = () => onScreen !== null || performance.now() - closedAt < WARM;

  return {
    enter(key) {
      hovered = key;
      if (shown === key) return cancel();
      // why only while the focused trigger's card is on screen: once Escape put it away, or it renders nothing, the pointer opens cards again.
      if (focused !== null && onScreen === focused) return;
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
      // why: the focused trigger held its card against the one the pointer rests on, which shows now.
      if (shown === key && hovered !== null && hovered !== key) return open(hovered);
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
    presence: (key) => ({
      close,
      mounted() {
        onScreen = key;
        return () => {
          if (onScreen === key) onScreen = null;
          if (shown !== key) return;
          if (focused === key) focused = null;
          close();
        };
      },
    }),
    stop() {
      cancel();
      clearTimeout(pressed);
    },
  };
}
