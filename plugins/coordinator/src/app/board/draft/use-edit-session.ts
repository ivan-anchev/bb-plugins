// A crew's edit session, kept in the browser's localStorage. why local, not session, storage: bb's
// composer keeps the edit's brief across closing the tab and restarting the app, so the rest of the
// edit lives as long; and every tab shows the one edit, so no tab saves over another's unseen.
import { useMemo, useSyncExternalStore } from "react";
import type { CoordinatorId, CrewId } from "../../../model/role.ts";
import { parsed, serialized, storageKeyOf, type EditSession } from "./edit-session.ts";

type StoredSession = {
  /** The edit, or null when none is open. */
  session: EditSession | null;
  /** Stores the edit; null ends it. */
  store(session: EditSession | null): void;
};

export function useEditSession(coordinatorId: CoordinatorId, crewId: CrewId): StoredSession {
  const key = storageKeyOf(coordinatorId, crewId);
  // why the raw string: it compares by value, so a read that finds the same edit renders nothing.
  const stored = useSyncExternalStore(subscribe, () => localStorage.getItem(key));
  const session = useMemo(() => parsed(stored), [stored]);
  return {
    session,
    store(next) {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, serialized(next));
      for (const listener of listeners) listener();
    },
  };
}

// why both: a write in this tab fires no storage event here, only in the other tabs.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
