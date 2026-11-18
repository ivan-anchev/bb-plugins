// The system's Reduce motion, the one place the working ring asks. Copied from Activity Sidebar
// (src/ui/motion/reduced-motion.ts), since plugins cannot import each other.

let query: MediaQueryList | null = null;

function reduceQuery(): MediaQueryList {
  query ??= matchMedia("(prefers-reduced-motion: reduce)");
  return query;
}

export function reducedMotion(): boolean {
  return reduceQuery().matches;
}

/** Calls `listener` when the setting changes; returns the unsubscribe. */
export function onReducedMotionChange(listener: () => void): () => void {
  const q = reduceQuery();
  q.addEventListener("change", listener);
  return () => q.removeEventListener("change", listener);
}
