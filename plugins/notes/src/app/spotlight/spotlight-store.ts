// Whether the Spotlight is open. Module state, because its openers are not components: a command's
// `run`, a sidebar-footer `onActivate`, and the card's link. The overlay reads it with
// useSyncExternalStore. Every opening is a new state object, and closing names the opening it
// closes: a save that finishes after its Spotlight was dismissed and reopened must not close the
// new draft.
import { useSyncExternalStore } from "react";

type SpotlightState = { kind: "closed" } | { kind: "compose" };

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
  // replace a draft the user is writing.
  compose(): void {
    if (state.kind === "closed") set({ kind: "compose" });
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
