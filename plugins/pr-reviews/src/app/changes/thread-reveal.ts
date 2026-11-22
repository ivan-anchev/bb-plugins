import { createContext, useCallback, useContext, type RefCallback } from "react";

/** `asked` counts the requests, so asking for the same thread again shows it again. */
export type ThreadReveal = { path: string; threadId: string; asked: number };

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
