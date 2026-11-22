import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import type { Coordinator, NotStarted } from "../../contract.ts";

/** A row: the regional manager as bb lists it, and the plugin's record of it. */
type CoordinatorGroup<Project, Thread> = { project: Project; rows: { coordinator: Coordinator; thread: Thread }[] };

/** What the list shows below its read errors. */
type ListView<Project, Thread> =
  | { kind: "loading" }
  | { kind: "listed"; notStarted: readonly NotStarted[]; groups: CoordinatorGroup<Project, Thread>[] }
  | { kind: "empty" }
  | { kind: "failed" };

type Read = { data: { coordinators: readonly Coordinator[]; notStarted: readonly NotStarted[] } | undefined; error: Error | null; isLoading: boolean };

/**
 * The list from its two reads: the plugin's regional managers and bb's live threads. The ones not
 * started yet need only the first; the started ones join them as bb's threads are read. It is "empty"
 * only when both reads succeeded, so a failed read never passes for a list with nothing in it; what a
 * failed refresh kept still shows.
 */
export function listView<Project extends { id: string }, Thread extends { id: string; projectId: string }>(
  read: Read,
  live: Pick<PluginSidebarThreadsState, "status"> & { threads: readonly Thread[]; projects: readonly Project[] },
): ListView<Project, Thread> {
  if (read.isLoading) return { kind: "loading" };
  const notStarted = read.data?.notStarted ?? [];
  const groups = groupByProject(read.data?.coordinators ?? [], live.threads, live.projects);
  if (notStarted.length > 0 || groups.length > 0) return { kind: "listed", notStarted, groups };
  if (live.status === "loading") return { kind: "loading" };
  return read.error === null && live.status === "ready" ? { kind: "empty" } : { kind: "failed" };
}

function groupByProject<Project extends { id: string }, Thread extends { id: string; projectId: string }>(
  coordinators: readonly Coordinator[],
  threads: readonly Thread[],
  projects: readonly Project[],
): CoordinatorGroup<Project, Thread>[] {
  const groups = new Map<string, CoordinatorGroup<Project, Thread>>();
  for (const coordinator of coordinators) {
    const thread = threads.find((t) => t.id === coordinator.threadId);
    const project = projects.find((p) => p.id === thread?.projectId);
    if (thread === undefined || project === undefined) continue;
    const group = groups.get(project.id) ?? { project, rows: [] };
    group.rows.push({ coordinator, thread });
    groups.set(project.id, group);
  }
  return [...groups.values()];
}
