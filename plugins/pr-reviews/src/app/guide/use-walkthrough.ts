// The reader's view of a guide: which steps the view options show, where the reader is among
// them, and the keys that move it.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Guide } from "../../guide/guide-schema.ts";
import { visibleSteps, type ViewOptions, type VisibleStep } from "../../guide/walkthrough.ts";
import type { ViewOptionsState } from "./view-options.tsx";
import { nextPosition, OVERVIEW, placeOf, positionAt, previousPosition, resolvePosition, type Place, type Position } from "./walkthrough-position.ts";

export type Walkthrough = {
  place: Place;
  /** The steps shown, which every count reads. */
  steps: VisibleStep[];
  next(): void;
  previous(): void;
  /** To the shown step numbered `number`, counted from 1 (an overview finding's link). */
  goToStep(number: number): void;
  /** For controls on the page, which a change can remove (the overview's "Tests and mocks" row). */
  setOptions(options: ViewOptions): void;
};

/** The page the walkthrough moves: its scroll region and the current page's title. */
export type WalkthroughPage = { scroll: RefObject<HTMLElement | null>; title: RefObject<HTMLElement | null> };

/**
 * Starts on the overview. When the view options change, from the header or from the page, the
 * reader stays on their step, or moves to the nearest earlier one still shown. Every move scrolls
 * the page back to the top. A change that removes the focused element (Start, an arrow at either
 * end, anything on the old page such as a finding's step link, the overview's "Tests and mocks"
 * row) hands focus to the new page's title, so keyboard focus never falls back to the document.
 */
export function useWalkthrough(guide: Guide, viewOptions: ViewOptionsState, page: WalkthroughPage): Walkthrough {
  const { options } = viewOptions;
  const [position, setPosition] = useState<Position>(OVERVIEW);
  // why state set while rendering: the options arrive as a prop (the header's switch sits outside
  // the guide), and the position must follow them before the page shows the new steps.
  const [positionOptions, setPositionOptions] = useState(options);
  if (positionOptions !== options) {
    setPositionOptions(options);
    setPosition(resolvePosition(visibleSteps(guide, options), position));
  }
  const focusedBeforeChange = useRef<Element | null>(null);
  // why an effect: only the committed page shows whether the change removed the focused element,
  // and bb's plugin runtime shares react but not react-dom, so flushSync is not an option.
  useLayoutEffect(
    function focusTitleWhenFocusWasRemoved() {
      const focused = focusedBeforeChange.current;
      focusedBeforeChange.current = null;
      if (focused !== null && !focused.isConnected) page.title.current?.focus();
    },
    [position, options, page.title],
  );
  const shownIndex = stepIndexOf(position);
  // why an effect: a move can come from the header's switch, outside the walkthrough's handlers.
  useLayoutEffect(
    function scrollNewPageToTop() {
      page.scroll.current?.scrollTo({ top: 0 });
    },
    [shownIndex, page.scroll],
  );
  const steps = visibleSteps(guide, options);
  const place = placeOf(steps, position);
  const moveTo = (to: Position) => {
    focusedBeforeChange.current = document.activeElement;
    setPosition(to);
  };
  return {
    place,
    steps,
    // ← on the overview, and → with no steps shown, land on the same OVERVIEW: React skips them.
    next: () => moveTo(nextPosition(steps, position)),
    previous: () => moveTo(previousPosition(steps, position)),
    goToStep: (number) => moveTo(positionAt(steps, number - 1)),
    setOptions: (next) => {
      focusedBeforeChange.current = document.activeElement;
      viewOptions.setOptions(next);
    },
  };
}

const stepIndexOf = (position: Position) => (position.kind === "overview" ? -1 : position.index);

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
