// The store, telling whoever acts on its regional managers' views of each manager whose issue facts
// a call through it wrote (migrations.ts fact_writes), as the call returns. why around every call:
// the store counts its own writes as they commit, so a writer that tells no one itself (a review
// report, a verdict, a way not yet built) is still heard, and no caller has a step to remember.
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "./store.ts";

/**
 * `store`, whose every call, as it returns or throws, tells the listener `tell` was given of each
 * manager whose fact writes moved since the last call. Before `tell`, writes are told to no one;
 * the tick reads every manager anyway.
 */
export function toldWrites<S extends Pick<Store, "everyFactWrites">>(store: S): { store: S; tell(listener: (id: CoordinatorId) => void): void } {
  let listener: (id: CoordinatorId) => void = () => {};
  let seen = store.everyFactWrites();

  function tellMoved(): void {
    const before = seen;
    seen = store.everyFactWrites();
    for (const [id, writes] of seen) if (before.get(id) !== writes) listener(id);
  }

  const told = new Proxy(store, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        // why also as it throws: a call making several writes outside one transaction may have committed some.
        try {
          return Reflect.apply(value, target, args);
        } finally {
          tellMoved();
        }
      };
    },
  });
  return {
    store: told,
    tell: (next) => {
      listener = next;
    },
  };
}
