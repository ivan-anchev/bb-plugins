// Whether the Spotlight is open, and on what. Module state, because its openers are not components:
// a message action's `run`, a command's `run`, a sidebar-footer `onActivate`, and the card's links
// and rows.
// The overlay reads it with useSyncExternalStore. Every opening is a new state object, and closing
// names the opening it closes: a save that finishes after its Spotlight was dismissed and reopened
// must not close the new draft.
import { useSyncExternalStore } from "react";
import type { Note, Quote } from "../../contract.ts";

/** A passage as a message action hands it over, before the Spotlight looks up its thread's title. */
export type Capture = Omit<Quote, "threadTitle">;

type SpotlightState = { kind: "closed" } | { kind: "compose"; capture: Capture | null } | { kind: "view"; noteId: Note["id"] };

let state: SpotlightState = { kind: "closed" };
const listeners = new Set<() => void>();

function set(next: SpotlightState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const spotlight = {
  // why a no-op while open: a second opener (a shortcut that still fires over the modal) must not
  // replace a draft the user is writing, or the note they are reading.
  compose(capture: Capture | null): void {
    if (state.kind === "closed") set({ kind: "compose", capture });
  },
  view(noteId: Note["id"]): void {
    if (state.kind === "closed") set({ kind: "view", noteId });
  },
  close(opening: SpotlightState): void {
    if (state === opening) set({ kind: "closed" });
  },
};

const snapshot = (): SpotlightState => state;

export function useSpotlightState(): SpotlightState {
  // why the server snapshot: spotlight-store.test.ts reads this hook through a server render.
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
