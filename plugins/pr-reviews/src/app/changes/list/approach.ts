// Tells the Changes tab's list which files are coming into view, so each draws its diff only as the
// reader nears it: one IntersectionObserver on the list's scroll region for every file, set up
// whichever of the region and a file arrives first.
import { createContext } from "react";

export type ApproachWatcher = {
  /** The list's scroll region; returns what stops the watching. */
  attach(region: HTMLElement): () => void;
  /** Calls `onNear` once, when `element` comes within reach of view; returns what stops it. */
  watch(element: Element, onNear: () => void): () => void;
};

// why this far ahead: a diff starts drawing a screen or two before it scrolls in, so it is drawn
// by the time it shows, and a fast scroll meets few blank cards.
const REACH = "1500px 0px";

// why one file a frame, in the order they near: a diff draws all its rows in one task, and the
// dozen files in reach as the list opens, drawn in one go, made one long frame (244 ms on a 4×
// slowed CPU). One a frame, the file at the top draws first and the page keeps answering.
export function approachWatcher(): ApproachWatcher {
  const waiting = new Map<Element, () => void>();
  const due: Element[] = [];
  let frame = 0;
  let observer: IntersectionObserver | null = null;
  const drawNext = () => {
    frame = 0;
    const element = due.shift()!;
    waiting.get(element)?.();
    waiting.delete(element);
    if (due.length > 0) frame = requestAnimationFrame(drawNext);
  };
  const arrived: IntersectionObserverCallback = (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer!.unobserve(entry.target);
      due.push(entry.target);
    }
    if (frame === 0 && due.length > 0) frame = requestAnimationFrame(drawNext);
  };
  return {
    attach(region) {
      observer = new IntersectionObserver(arrived, { root: region, rootMargin: REACH });
      for (const element of waiting.keys()) observer.observe(element);
      return () => {
        observer!.disconnect();
        observer = null;
        cancelAnimationFrame(frame);
        frame = 0;
        due.length = 0;
      };
    },
    watch(element, onNear) {
      waiting.set(element, onNear);
      observer?.observe(element);
      return () => {
        waiting.delete(element);
        observer?.unobserve(element);
      };
    },
  };
}

export const ApproachContext = createContext<ApproachWatcher | null>(null);
