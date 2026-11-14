// Test rows: a valid PluginSidebarThread with the fields a test cares about overridden.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export function thread(id: string, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id,
    projectId: "prj_a",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/prj_a/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
    ...overrides,
  };
}

export function project(id: string, name: string): PluginSidebarProject {
  return { id, name, isPersonal: false, href: `/projects/${id}`, settingsHref: `/projects/${id}/settings` };
}

/** Working, as bb resolves a running turn. */
export const WORKING = { indicator: "runtime", status: "active", runtimeStatus: "active" } as const satisfies Partial<PluginSidebarThread>;
