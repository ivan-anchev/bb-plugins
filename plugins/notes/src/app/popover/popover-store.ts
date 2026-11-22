import { useSyncExternalStore } from "react";
import type { Quote } from "../../contract.ts";

/** A passage as a message action hands it over, before the form looks up its thread's title. */
export type Capture = Omit<Quote, "threadTitle">;

/**
 * `panel`: focus the popover itself, so the form rests as one line. `form`: focus the form's field,
 * which opens it. `focusRequest` counts requests, so a second one while open moves focus again.
 */
type Focus = "panel" | "form";

/** Who opened it, for where focus goes back on close: the footer button, or whatever had focus. */
type Opener = "button" | "focus";

/** `opening` counts openings: one opening, one draft and one set of picks. */
type OpenState = { open: true; opening: number; openedBy: Opener; quote: Capture | null; focus: Focus; focusRequest: number };
export type PopoverState = { open: false } | OpenState;

let state: PopoverState = { open: false };
let openings = 0;
let requests = 0;
const listeners = new Set<() => void>();

function set(next: PopoverState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function show(focus: Focus, openedBy: Opener, quote?: Capture): void {
  requests += 1;
  set(
    state.open
      ? { ...state, focus, focusRequest: requests, quote: quote ?? state.quote }
      : { open: true, opening: (openings += 1), openedBy, quote: quote ?? null, focus, focusRequest: requests },
  );
}

export const notesPopover = {
  /** The sidebar-footer button: opens with focus on the popover itself, or closes. */
  toggleFromButton(): void {
    if (state.open) set({ open: false });
    else show("panel", "button");
  },
  /** ⇧⌘J and the card's "New note": the form, focused. (⇧⌘J inside the popover closes it instead.) */
  write(): void {
    show("form", "focus");
  },
  /**
   * "Add to notes": the form, quoting the passage. A user message quotes nothing (null), so it opens
   * the form and keeps any quote already there.
   */
  capture(capture: Capture | null): void {
    show("form", "focus", capture ?? undefined);
  },
  /**
   * A save used `quote`, so the form starts the next note without it. why by identity: a passage
   * captured while that save was in flight is the next note's, and stays.
   */
  clearQuote(quote: Capture): void {
    if (state.open && state.quote === quote) set({ ...state, quote: null });
  },
  close(): void {
    if (state.open) set({ open: false });
  },
  /** Whether `opening` is still on screen: not closed, and not replaced by a later opening. */
  isShowing(opening: number): boolean {
    return state.open && state.opening === opening;
  },
};

const snapshot = (): PopoverState => state;

export function usePopoverState(): PopoverState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
