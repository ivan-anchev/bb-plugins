// Tests only: bb's sidebar as `experimental_useSidebarThreads` reports it, whole: a project, and an
// idle, read thread in it titled as bb shows it.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export const PROJECT: PluginSidebarProject = { id: "prj_1", name: "Webhooks", isPersonal: false, href: "/projects/prj_1", settingsHref: "/projects/prj_1/settings" };

export function sidebarThread(id: string, title: string): PluginSidebarThread {
  return {
    id,
    projectId: PROJECT.id,
    title,
    titleFallback: null,
    displayTitle: title,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: "regional-manager",
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    lastReadAt: 1_000,
    latestAttentionAt: 1_000,
  };
}
