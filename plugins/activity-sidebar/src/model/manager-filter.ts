// The Managers view's own project filter, apart from the threads': offered only once the managers
// span two or more projects, and only among those. Pure.
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import type { ManagerModel, Managers } from "./activity.ts";

/**
 * The projects the managers can be narrowed to, in the sidebar's order: those holding one, once there
 * are two or more of them. None while every manager shares one project, where narrowing changes nothing.
 */
export function managerProjects(managers: Managers, projects: readonly PluginSidebarProject[]): readonly PluginSidebarProject[] {
  const held = new Set([...managers.pinned, ...managers.unpinned].map((m) => m.thread.projectId));
  const offered = projects.filter((p) => held.has(p.id));
  return offered.length >= 2 ? offered : [];
}

/** The managers in `projectId` only, pinned and not; all of them for null. */
export function narrowManagers(managers: Managers, projectId: string | null): Managers {
  if (projectId === null) return managers;
  const inProject = (m: ManagerModel) => m.thread.projectId === projectId;
  return { pinned: managers.pinned.filter(inProject), unpinned: managers.unpinned.filter(inProject) };
}
