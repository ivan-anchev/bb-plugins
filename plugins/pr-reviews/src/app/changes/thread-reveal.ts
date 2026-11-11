// A review thread the reader asked to see in the Changes tab, from a row of the Summary tab's
// activity. The Changes panel selects the thread's file; the thread opens if it was folded, and
// once its diff draws it scrolls into view and takes focus. A thread that is asked for once.
import { createContext, useCallback, useContext, type RefCallback } from "react";

/** `asked` counts the requests, so asking for the same thread again shows it again. */
export type ThreadReveal = { path: string; threadId: string; asked: number };

/** The page's pending reveal, and what a thread calls once it is in view. */
type RevealRequest = { reveal: ThreadReveal | null; onRevealed(): void };

const RevealContext = createContext<RevealRequest>({ reveal: null, onRevealed: () => undefined });

export const ThreadRevealProvider = RevealContext.Provider;

/**
 * For a thread card: whether the page waits to show it, and the ref of the element that scrolls
 * into view and takes focus once drawn.
 */
export function useThreadReveal(threadId: string): { asked: boolean; target: RefCallback<HTMLElement> } {
  const { reveal, onRevealed } = useContext(RevealContext);
  const asked = reveal !== null && reveal.threadId === threadId;
  // why wait for a size: a thread under a line is a note Pierre slots into its shadow root after
  // this render, so it has no box to scroll to until it is drawn.
  const target = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      if (element === null || !asked) return;
      const drawn = new ResizeObserver(() => {
        if (element.getClientRects().length === 0) return;
        drawn.disconnect();
        element.scrollIntoView({ block: "center" });
        element.focus({ preventScroll: true });
        onRevealed();
      });
      drawn.observe(element);
      return () => drawn.disconnect();
    },
    [asked, onRevealed],
  );
  return { asked, target };
}
