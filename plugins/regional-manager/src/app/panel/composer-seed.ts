// Where a new regional manager starts unless the user picks otherwise.
import type { NewThreadComposerProps, PluginSidebarProject, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";

export type ComposerSeed = Pick<NewThreadComposerProps, "defaultProjectId" | "defaultEnvironment">;

/**
 * The project in view, else the first of the user's projects in sidebar order (a plugin page has none
 * in view, and the thread works on one), in a fresh worktree on the machine running bb, so a stray
 * edit lands on its own branch and never in the user's checkout. With no machine joined yet, the
 * composer picks its own. Null until both reads have succeeded: a seed from a failed read would
 * leave out the worktree for good, since the composer is seeded once.
 */
export function composerSeed(
  projectInView: string | null,
  sidebar: Pick<PluginSidebarThreadsState, "status"> & { projects: readonly Pick<PluginSidebarProject, "id" | "isPersonal">[] },
  host: { hostId: string | null } | undefined,
): ComposerSeed | null {
  if (sidebar.status !== "ready" || host === undefined) return null;
  const { hostId } = host;
  return {
    defaultProjectId: projectInView ?? sidebar.projects.find((project) => !project.isPersonal)?.id,
    defaultEnvironment: hostId === null ? undefined : { type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
  };
}
