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

  const arm =
    (into: Start): Arm =>
    () => {
      const ids = picks.ids;
      let fire!: Fire;
      const filled = new Promise<boolean>((resolve) => {
        fire = () => {
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
    thisThread,
    error: start.error,
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
