// A draft on the board: its headline and the start of its brief, with Start and Edit. Start spawns
// the crew from what is stored; Edit opens the draft's editor under the row, which stays open, through
// a remount or a reload, until the edit is saved or cancelled.
import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import type { Ref } from "react";
import { coordinatorContract as contract, type BoardRow, type Draft } from "../../../contract.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { Button } from "../../ui/button.tsx";
import { useFocusHandOff } from "../../ui/focus-hand-off.ts";
import { DraftEditor } from "./draft-editor.tsx";
import { opened } from "./edit-session.ts";
import { useEditSession } from "./use-edit-session.ts";

type DraftRowProps = { ref: Ref<HTMLDivElement>; coordinatorId: CoordinatorId; row: BoardRow; draft: Draft };

export function DraftRow({ ref, coordinatorId, row, draft }: DraftRowProps) {
  const edit = useEditSession(coordinatorId, row.crewId);
  const editing = edit.session !== null;
  const start = experimental_useRpcMutation({ contract, method: "startDraft" });
  // Closing the editor hands its focus to Edit, which comes back as it leaves.
  const focus = useFocusHandOff();

  // why the catch: the hook's error shows beside the buttons; the rejection carries nothing more.
  // Once started, the row moves to its new group and the board keeps focus on it there.
  const startCrew = () => void start.mutate({ coordinatorId, crewId: row.crewId }).catch(() => undefined);

  return (
    <div ref={ref} className="flex flex-col rounded-md px-2 py-1.5">
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5">
        <span className="font-mono text-xs text-muted-foreground">{row.crewId}</span>
        <span className="truncate text-sm">{row.headline}</span>
        {/* The editor shows the whole brief, and its own send button and Cancel. */}
        {!editing && (
          <>
            <div className="row-span-2 flex items-center gap-1">
              <Button ref={focus.to} variant="ghost" size="sm" onClick={() => edit.store(opened(draft, Date.now()))}>
                Edit
              </Button>
              {/* why aria-disabled: a disabled button drops focus to the page while the crew starts. */}
              <Button variant="default" size="sm" aria-disabled={start.isPending} onClick={start.isPending ? undefined : startCrew}>
                {start.isPending ? "Starting…" : "Start"}
              </Button>
            </div>
            <span className="col-start-2 truncate text-xs text-muted-foreground">{firstLine(draft.brief)}</span>
          </>
        )}
      </div>
      {start.error !== null && (
        <p role="alert" className="pt-1 pl-[2.75rem] text-xs text-destructive-text">
          Could not start it: {start.error.message}
        </p>
      )}
      {edit.session !== null && (
        <DraftEditor
          ref={focus.from}
          coordinatorId={coordinatorId}
          crewId={row.crewId}
          draft={draft}
          session={edit.session}
          onEdit={edit.store}
          onClose={() => edit.store(null)}
        />
      )}
    </div>
  );
}

/** The brief's first line with text on it, without a heading's marks. */
const firstLine = (brief: string): string => brief.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find((line) => line !== "") ?? "";
