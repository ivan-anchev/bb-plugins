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
  useEffect(() => {
    life.begin();
    return life.end;
  }, [life]);
  return life;
}
