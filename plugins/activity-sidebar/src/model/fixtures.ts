// Test rows: a valid PluginSidebarThread with the fields a test cares about overridden; and the
// Regional Manager plugin's `coordinators` and `openIssues` answers, well formed and not.
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

export const AVATAR = { kind: "blob", shape: "bear", hue: "violet", expression: "attentive" } as const;

/** The Regional Manager plugin's answer, as it publishes it: more than the sidebar reads. */
export const COORDINATORS = {
  coordinators: [
    { id: "mgr_1", threadId: "thr_pr", projectId: "prj_a", description: "Reviews every open pull request.", avatar: AVATAR },
    { id: "mgr_2", threadId: "thr_sb", projectId: "prj_a", description: null, avatar: { ...AVATAR, shape: "bunny", hue: "rose" } },
  ],
  notStarted: [{ id: "mgr_3", name: "Docs", description: null, avatar: AVATAR }],
};

/** Answers the sidebar's copy of the schema refuses: each must leave every manager on its fallback. */
export const MALFORMED_COORDINATORS: readonly unknown[] = [
  { managers: [] },
  { coordinators: [{ id: "mgr_1", threadId: "thr_pr", description: null }] },
  { coordinators: [{ id: "mgr_1", threadId: "thr_pr", description: null, avatar: { ...AVATAR, shape: "octagon" } }] },
  { coordinators: [{ id: "mgr_1", thread: "thr_pr", description: null, avatar: AVATAR }] },
  { coordinators: [{ threadId: "thr_pr", description: null, avatar: AVATAR }] },
  { coordinators: [COORDINATORS.coordinators[0], { ...COORDINATORS.coordinators[1], threadId: "thr_pr" }] },
];

/** The Regional Manager plugin's `openIssues` answer for mgr_1, as it publishes it. */
export const OPEN_ISSUES = {
  mgr_1: {
    needsYou: [{ id: "WEB-5", title: "Schema version", status: "in-progress", reason: "Blocked: which schema version?", parentId: "WEB-4" }],
    underWay: [{ id: "WEB-2", title: "Retry queue", status: "reviewing", parentId: null }],
    parents: [{ id: "WEB-4", title: "Webhook schema", status: "todo" }],
    decisions: [{ id: "d1", question: "Ship on Friday?" }],
  },
};

/** `openIssues` answers the sidebar's copy of the schema refuses: each leaves every card without its list. */
export const MALFORMED_OPEN_ISSUES: readonly unknown[] = [
  { mgr_1: { needsYou: [] } },
  { mgr_1: { ...OPEN_ISSUES.mgr_1, underWay: [{ id: "WEB-2", title: "Retry queue", status: "shipping", parentId: null }] } },
  { mgr_1: { ...OPEN_ISSUES.mgr_1, needsYou: [{ id: "WEB-5", title: "Schema version", status: "in-progress", parentId: null }] } },
  [OPEN_ISSUES.mgr_1],
];
