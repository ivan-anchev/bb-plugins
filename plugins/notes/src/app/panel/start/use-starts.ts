// The panel's two starts, wired to its picks: armed by a click on the split button, a pick in its
// menu, or a shortcut (start-shortcut.ts), each holding the picks until the draft has them.
import type { KeyboardEvent, RefObject } from "react";
import type { Picks } from "../use-picks.ts";
import type { Arm, Fire } from "./start-button.tsx";
import { inTextField, startShortcut } from "./start-shortcut.ts";
import { useStartThread, type Start } from "./use-start-thread.ts";

type StartsOptions = {
  picks: Picks;
  /** The list, where focus waits while a start runs. */
  waitFocus: RefObject<HTMLElement | null>;
  /** Whether the host that started it is still on screen once the draft holds the brief. */
  isCurrent(): boolean;
  /** After a start filled the composer, while its host is still on screen. */
  onStarted?(): void;
};

export function useStarts({ picks, waitFocus, isCurrent, onStarted }: StartsOptions) {
  const start = useStartThread();

  /**
   * Holds the picks from now until the draft has them, so no tick, Clear or Esc lands while the start
   * waits to fire or runs. Firing moves focus to the list, where it waits: the hold disables the
   * footer's buttons, and a disabled button drops focus to the page body.
   */
  const arm =
    (into: Start): Arm =>
    () => {
      const ids = picks.ids;
      let fire!: Fire;
      const filled = new Promise<boolean>((resolve) => {
        fire = () => {
          // why `?.`: a menu's close can fire after the popover holding the list has gone.
          waitFocus.current?.focus();
          resolve(into(ids, { isCurrent }));
        };
      });
      picks.submit(
        filled.then((done) => {
          if (done && isCurrent()) onStarted?.();
          return done;
        }),
      );
      return fire;
    };
  const newThread = arm(start.newThread);
  const thisThread = start.thisThread && arm(start.thisThread);

  return {
    newThread,
    /** Null where no thread is on screen. */
    thisThread,
    error: start.error,
    /**
     * ⌘↵ and ⇧⌘↵ start as a click would, while notes are picked and focus is in the panel, not in a
     * field. why the capture phase: Radix takes any Enter, modified or not, on the chevron (opening
     * the menu) before a bubbling handler sees it; taking the chord first stops that (Radix skips a
     * prevented event). A press in the start menu, a portal, is left to the menu (start-button.tsx):
     * only the menu can close before its start fires.
     */
    onKeyDownCapture: (event: KeyboardEvent) => {
      const kind = startShortcut(event);
      if (kind === null || picks.ids.length === 0 || picks.held || inTextField(event.target)) return;
      if (!(event.target instanceof Node && event.currentTarget.contains(event.target))) return;
      const chosen = kind === "new-thread" ? newThread : thisThread;
      if (chosen === null) return;
      event.preventDefault();
      chosen()();
    },
  };
}
