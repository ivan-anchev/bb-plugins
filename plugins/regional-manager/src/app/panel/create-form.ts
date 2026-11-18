// The New page's choices, apart from the profile: where a new regional manager works and what it
// runs on, where they start, and the request they make.
import type { ExperimentalPermissionModePickerProps, ExperimentalProviderModelPickerValue, PluginSidebarProject, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import type { ManagerRequest, NewSeed } from "../../contract.ts";

/** Where it works: a fresh worktree of its project, the project's own checkout, or no project at all. */
export type Place = "worktree" | "checkout" | "personal";

export type CreateChoices = {
  /** The project it works on, for a worktree or the checkout. */
  projectId: string;
  place: Place;
  /** The branch a worktree is cut from; null: the project's default branch. */
  baseBranch: string | null;
  execution: ExperimentalProviderModelPickerValue;
  permissionMode: ExperimentalPermissionModePickerProps["value"];
};

/** What the choices start from, and what the page needs beside them: the machine running bb (null: none has joined), and the user's projects and their personal one (null: none listed). */
export type CreateStart = {
  choices: CreateChoices;
  hostId: string | null;
  projects: readonly Pick<PluginSidebarProject, "id" | "name">[];
  personalProjectId: string | null;
};

type Sidebar = Pick<PluginSidebarThreadsState, "status"> & { projects: readonly Pick<PluginSidebarProject, "id" | "name" | "isPersonal">[] };

/**
 * The project in view, else the first of the user's projects in sidebar order (a plugin page has none
 * in view), in a fresh worktree from its default branch on the machine running bb, so a stray edit
 * lands on its own branch and never in the user's checkout, on bb's default provider and model there,
 * with auto permissions. Null until both reads have succeeded; `{ missing }` when there is nothing to
 * start from, and why.
 * why auto: a permission prompt on the regional manager would hold everything behind it.
 */
export function createStart(projectInView: string | null, sidebar: Sidebar, seed: NewSeed | undefined): CreateStart | { missing: string } | null {
  if (sidebar.status !== "ready" || seed === undefined) return null;
  const projects = sidebar.projects.filter(({ isPersonal }) => !isPersonal);
  const projectId = projects.find(({ id }) => id === projectInView)?.id ?? projects[0]?.id;
  if (projectId === undefined) return { missing: "Add a project to bb first: a regional manager works on one." };
  if (seed.execution === null) return { missing: "bb can run no provider on this machine yet. Set one up in bb's settings." };
  return {
    choices: { projectId, place: "worktree", baseBranch: null, execution: seed.execution, permissionMode: "auto" },
    hostId: seed.hostId,
    projects: projects.map(({ id, name }) => ({ id, name })),
    personalProjectId: sidebar.projects.find(({ isPersonal }) => isPersonal)?.id ?? null,
  };
}

/** What the choices ask threads.spawn for, on the machine running bb (null: bb picks one). */
export function requestOf({ projectId, place, baseBranch, execution, permissionMode }: CreateChoices, { hostId, personalProjectId }: Pick<CreateStart, "hostId" | "personalProjectId">): ManagerRequest {
  const host = hostId === null ? {} : { hostId };
  const run = { ...execution, permissionMode };
  switch (place) {
    case "worktree":
      return { ...run, projectId, environment: { type: "host", ...host, workspace: { type: "managed-worktree", baseBranch: baseBranch === null ? { kind: "default" } : { kind: "named", name: baseBranch } } } };
    case "checkout":
      return { ...run, projectId, environment: { type: "host", ...host, workspace: { type: "unmanaged", path: null } } };
    case "personal":
      // why the personal project: bb files a thread with no project under it. The page offers no project only when bb lists one.
      if (personalProjectId === null) throw new Error("bb lists no personal project to work in.");
      return { ...run, projectId: personalProjectId, environment: { type: "host", ...host, workspace: { type: "personal" } } };
    default:
      return place satisfies never;
  }
}
