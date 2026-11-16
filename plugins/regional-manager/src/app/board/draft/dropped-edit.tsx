// An edit still open on a crew that stopped being a draft before it was saved: started from another
// device, or closed by the Coordinator. There is no draft left to save it to, so the row says so
// until the user dismisses it, and the edit never vanishes unexplained.
import type { BoardRow } from "../../../contract.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { Button } from "../../ui/button.tsx";
import { handFocusToPage } from "../../ui/focus-hand-off.ts";
import { useEditSession } from "./use-edit-session.ts";

export function DroppedEdit({ coordinatorId, row }: { coordinatorId: CoordinatorId; row: BoardRow }) {
  const edit = useEditSession(coordinatorId, row.crewId);
  if (edit.session === null) return null;
  return (
    <div ref={handFocusToPage} role="status" className="flex flex-wrap items-center gap-x-2 pl-[2.75rem] text-xs text-muted-foreground">
      <p>Your unsaved edit of this draft was not used: the crew {row.threadId === null ? "was closed" : "started"} before you saved it.</p>
      <Button variant="ghost" size="sm" onClick={() => edit.store(null)}>
        Dismiss
      </Button>
    </div>
  );
}
