import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { Fragment } from "react";
import { MemorySection } from "../memory/memory-section.tsx";
import { useCoordinatorOfThread, useIsManagerThread } from "../profile/use-manager.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { TabPage } from "../ui/tab-page.tsx";
import { Board } from "./board.tsx";

export const boardTab = {
  id: "board",
  context: { kind: "thread" },
  availability: "fixed",
  title: "Board",
  icon: "LayoutList",
  layout: "flush",
  component: BoardTab,
  useVisible: useIsManagerThread,
} as const;

function BoardTab({ threadId }: ExperimentalThreadTabProps) {
  const { read, coordinator } = useCoordinatorOfThread(threadId);
  const coordinatorId = coordinator?.id ?? null;
  return (
    <TabPage>
      {read.error !== null && coordinatorId === null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the board: {read.error.message}</ReadFailure>}
      {coordinatorId !== null && (
        <Fragment key={coordinatorId}>
          <Board coordinatorId={coordinatorId} />
          <MemorySection coordinatorId={coordinatorId} />
        </Fragment>
      )}
    </TabPage>
  );
}
