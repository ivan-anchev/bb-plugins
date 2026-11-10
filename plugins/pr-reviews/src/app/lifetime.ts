// How long a piece of the page is on screen, for the async work it starts: a completion bound to
// it runs only while that piece is still there, so work never outlives its owner (REVIEW.md).
import { useEffect, useState } from "react";

export type Lifetime = {
  /** `then`, run only while the owner is on screen; once it has gone, a call does nothing. */
  bind<Args extends unknown[]>(then: (...args: Args) => void): (...args: Args) => void;
  begin(): void;
  end(): void;
};

export function lifetime(): Lifetime {
  let live = false;
  return {
    bind: (then) => (...args) => {
      if (live) then(...args);
    },
    begin: () => (live = true),
    end: () => (live = false),
  };
}

/** The calling component's lifetime: from its mount to its unmount. */
export function useLifetime(): Lifetime {
  const [life] = useState(lifetime);
  // why begin in the effect, not at creation: StrictMode unmounts and mounts again, and the second
  // mount must be live.
  useEffect(() => {
    life.begin();
    return life.end;
  }, [life]);
  return life;
}
