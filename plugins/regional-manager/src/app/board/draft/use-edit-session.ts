// A crew's edit session, kept in the browser's localStorage. why local, not session, storage: bb's
// composer keeps the edit's brief across closing the tab and restarting the app, so the rest of the
// edit lives as long; and every tab shows the one edit, so no tab saves over another's unseen.
import type { CoordinatorId, CrewId } from "../../../model/role.ts";
import { useStored } from "../../ui/stored.ts";
import { editSessionSchema, storageKeyOf, type EditSession } from "./edit-session.ts";

type StoredSession = {
  /** The edit, or null when none is open. */
  session: EditSession | null;
  /** Stores the edit; null ends it. */
  store(session: EditSession | null): void;
};

export function useEditSession(coordinatorId: CoordinatorId, crewId: CrewId): StoredSession {
  const { value, store } = useStored(localStorage, storageKeyOf(coordinatorId, crewId), editSessionSchema);
  return { session: value, store };
}
