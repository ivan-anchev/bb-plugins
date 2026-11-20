// The Board tab, fixed in every regional manager's side panel and in no other thread's: its board,
// with its memory at the bottom.
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { Fragment } from "react";
import { MemorySection } from "../memory/memory-section.tsx";
import { useCoordinatorOfThread } from "../profile/use-manager.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { Board } from "./board.tsx";

export const boardTab = {
  id: "board",
  context: { kind: "thread" },
  availability: "fixed",
  title: "Board",
  icon: "LayoutList",
  layout: "flush",
  component: BoardTab,
  useVisible: ({ threadId }: ExperimentalThreadTabProps) => useCoordinatorOfThread(threadId).coordinator !== null,
} as const;

function BoardTab({ threadId }: ExperimentalThreadTabProps) {
  const { read, coordinator } = useCoordinatorOfThread(threadId);
  const coordinatorId = coordinator?.id ?? null;
  return (
    // why the tab stop: the board scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4">
        {read.error !== null && coordinatorId === null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the board: {read.error.message}</ReadFailure>}
        {coordinatorId !== null && (
          <Fragment key={coordinatorId}>
            <Board coordinatorId={coordinatorId} />
            <MemorySection coordinatorId={coordinatorId} />
          </Fragment>
        )}
      </div>
    </div>
  );
}
