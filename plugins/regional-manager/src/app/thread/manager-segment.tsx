// A regional manager's own thread names it in the context row above its composer: its icon and its
// name, and never its description, which only its page in the panel shows.
import { experimental_THREAD_CONTEXT_SEGMENT_GROUPS as GROUPS, type ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk/app";
import { AvatarTile } from "../profile/avatar.tsx";
import { useCoordinatorOfThread, useManager } from "../profile/use-manager.ts";

export const managerSegment = {
  id: "manager",
  title: "Regional manager",
  group: GROUPS.thread,
  summary: ManagerSegment,
  useVisible: ({ threadId }: { threadId: string }) => useCoordinatorOfThread(threadId).coordinator !== null,
};

function ManagerSegment({ threadId }: ExperimentalThreadContextSegmentProps) {
  const { coordinator } = useCoordinatorOfThread(threadId);
  const profile = useManager(coordinator?.id ?? null)?.profile ?? null;
  return profile === null ? null : (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <AvatarTile avatar={profile.avatar} size="xs" />
      <span className="truncate">{profile.name}</span>
    </span>
  );
}
