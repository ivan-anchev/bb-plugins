// The reader's position in a guide, and the keys that move it.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { nextPosition, OVERVIEW, placeOf, previousPosition, type Place, type Position, type VisibleStep } from "./walkthrough-position.ts";

export type Walkthrough = { place: Place; total: number; next(): void; previous(): void };

/** The page the walkthrough moves: its scroll region and the current page's title. */
export type WalkthroughPage = { scroll: RefObject<HTMLElement | null>; title: RefObject<HTMLElement | null> };

/**
 * Starts on the overview. Every move scrolls the page back to the top. A move that removes the
 * focused element (Start, an arrow at either end, anything on the old page) hands focus to the
 * new page's title, so keyboard focus never falls back to the document.
 */
export function useWalkthrough(steps: VisibleStep[], page: WalkthroughPage): Walkthrough {
  const [position, setPosition] = useState<Position>(OVERVIEW);
  const focusedBeforeMove = useRef<Element | null>(null);
  // why an effect: only the committed page shows whether the move removed the focused element,
  // and bb's plugin runtime shares react but not react-dom, so flushSync is not an option.
  useLayoutEffect(
    function focusTitleWhenFocusWasRemoved() {
      const focused = focusedBeforeMove.current;
      focusedBeforeMove.current = null;
      if (focused !== null && !focused.isConnected) page.title.current?.focus();
    },
    [position, page.title],
  );
  const place = placeOf(steps, position);
  const moveTo = (to: Position) => {
    focusedBeforeMove.current = document.activeElement;
    setPosition(to);
    page.scroll.current?.scrollTo({ top: 0 });
  };
  return {
    place,
    total: steps.length,
    next: () => moveTo(nextPosition(steps, position)),
    previous: () => {
      // ← on the overview does nothing, so it does not scroll the overview either.
      if (place.kind === "step") moveTo(previousPosition(steps, position));
    },
  };
}

// → and J move to the next step, ← and K to the previous one. Ignored while typing (inputs,
// textareas, selects, contenteditable, such as bb's composer in a split view), with a modifier
// held, or when something else already handled the key.
// why an effect: a document listener is a subscription to the DOM.
export function useStepKeys({ next, previous }: Walkthrough): void {
  useEffect(
    function moveOnStepKeys() {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
        const direction = STEP_KEYS[event.key];
        if (direction === undefined) return;
        event.preventDefault();
        if (direction === "next") next();
        else previous();
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    },
    [next, previous],
  );
}

const STEP_KEYS: Partial<Record<string, "next" | "previous">> = { ArrowRight: "next", j: "next", ArrowLeft: "previous", k: "previous" };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null);
