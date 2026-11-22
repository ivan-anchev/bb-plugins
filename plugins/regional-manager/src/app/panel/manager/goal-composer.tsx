import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { coordinatorContract as contract } from "../../../contract.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { ReadFailure } from "../../ui/read-failure.tsx";
import { composerSeed, type ComposerSeed } from "./composer-seed.ts";

type GoalComposerProps = { coordinatorId: CoordinatorId; name: string; onStarted(threadId: string): void };

export function GoalComposer({ coordinatorId, name, onStarted }: GoalComposerProps) {
  const { seed, host, sidebarFailed } = useComposerSeed();
  const start = experimental_useRpcMutation({ contract, method: "startCoordinator" });

  async function submit(request: NewThreadRequest) {
    const { threadId } = await start.mutate({ coordinatorId, request });
    onStarted(threadId);
  }

  return (
    <div className="flex flex-col gap-2">
      {seed === null && host.error !== null && <ReadFailure onRetry={() => void host.refetch()}>Could not find the machine running bb: {host.error.message}</ReadFailure>}
      {seed === null && sidebarFailed && <ReadFailure>Could not read your projects from bb.</ReadFailure>}
      {seed !== null && (
        <NewThreadComposer
          defaultProjectId={seed.defaultProjectId}
          defaultEnvironment={seed.defaultEnvironment}
          defaultPermissionMode="auto"
          placeholder={`What should ${name} get done?`}
          draftKey={`coordinator-goal:${coordinatorId}`}
          layout="document"
          onSubmit={submit}
        />
      )}
      {start.error !== null && (
        <p role="alert" className="px-3 text-sm text-destructive-text">
          Could not start it: {start.error.message}
        </p>
      )}
    </div>
  );
}

function useComposerSeed() {
  const context = useBbContext();
  const sidebar = useSidebarThreads();
  const host = experimental_useRpcQuery({ contract, method: "primaryHost", input: {} });
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  if (seed === null) {
    const ready = composerSeed(context.projectId, sidebar, host.data);
    if (ready !== null) setSeed(ready);
  }
  return { seed, host, sidebarFailed: sidebar.status === "error" };
}
