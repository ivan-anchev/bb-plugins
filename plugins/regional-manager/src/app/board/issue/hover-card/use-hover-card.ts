// Which row's hover card shows on the board (card-intent.ts says when): the card sits in its row's
// box, joined to it with no gap (hover-card.css), so the pointer on the card is on its row. A press
// on the board puts it away. A touch has no hover: its tap opens the issue.
import type { FocusEvent, HTMLAttributes, PointerEvent } from "react";
import { useCardIntent } from "./card-intent.ts";

type HoverCards = {
  /** The key of the row whose card shows; null: none. */
  shown: string | null;
  /** On a row's box: the pointer and focus events that open and close its card. */
  trigger(key: string): HTMLAttributes<HTMLDivElement>;
  /** On the board: a press puts the card away. */
  board: HTMLAttributes<HTMLDivElement>;
  /** Puts the card away, as Escape does (hover-card.tsx). */
  close(): void;
};

export function useHoverCards(): HoverCards {
  const { shown, intent } = useCardIntent<string>();
  return {
    shown,
    close: intent.close,
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
