// A regional manager not started yet, on its page: bb's own new-thread composer, seeded with a fresh
// worktree and auto permissions. The message sent is its goal: the server spawns its thread on what
// the composer picked, titled with its name, and the page opens it.
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

  // The composer keeps the draft when this throws, so a failed start never loses the goal.
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
          // why auto: a permission prompt on the regional manager would hold everything behind it.
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

/**
 * The composer's seed, fixed once both reads have succeeded (see composerSeed), plus the reads, so the
 * page can say why there is none yet.
 * why it is fixed once ready: the composer re-seeds every picker when a seed changes, and unmounting
 * it drops them too, so a later read (a project added, the thread list reloading) must not undo what
 * the user picked.
 */
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
