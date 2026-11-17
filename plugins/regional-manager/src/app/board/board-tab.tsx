// The Board tab, fixed in every regional manager's side panel and in no other thread's.
import { experimental_useRpcQuery, type ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract } from "../../contract.ts";
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
  useVisible: ({ threadId }: ExperimentalThreadTabProps) => useCoordinatorOf(threadId).coordinatorId !== null,
} as const;

/** The regional manager this thread is, from the same read as the panel's list. */
function useCoordinatorOf(threadId: string) {
  const read = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  return { read, coordinatorId: read.data?.coordinators.find((coordinator) => coordinator.threadId === threadId)?.id ?? null };
}

function BoardTab({ threadId }: ExperimentalThreadTabProps) {
  const { read, coordinatorId } = useCoordinatorOf(threadId);
  return (
    // why the tab stop: the board scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4">
        {read.error !== null && coordinatorId === null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the board: {read.error.message}</ReadFailure>}
        {coordinatorId !== null && <Board key={coordinatorId} coordinatorId={coordinatorId} />}
      </div>
    </div>
  );
}
