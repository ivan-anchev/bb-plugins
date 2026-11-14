// Test views: every section open unless a test says otherwise, every archived thread loaded. Test layouts
// of quiet threads, for the list's motion.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { buildActivity, type SectionKey } from "../model/activity.ts";
import { thread } from "../model/fixtures.ts";
import { listItems, type ArchivePager, type ListView } from "./items.ts";
import { layoutItems, type Layout } from "./layout.ts";

export const LOADED: ArchivePager = { status: "ready", hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false };

export function view(overrides: Partial<ListView> = {}): ListView {
  const open: SectionKey[] = ["pinned", "activity", "working", "asleep", "archived"];
  return { status: "ready", sleeps: "ready", open: new Set(open), archivedShown: 10, archive: LOADED, filterName: null, compact: true, ...overrides };
}

export const SHOWN: SectionKey[] = ["pinned", "activity", "working", "asleep"];

/** The list's layout of `threads` in a sidebar `viewport` tall, Archived folded unless `open` says otherwise. */
export function layout(threads: readonly PluginSidebarThread[], open: readonly SectionKey[] = SHOWN, viewport = 800): Layout {
  const sections = buildActivity({ threads, projects: [], sleeps: new Map(), held: new Set(), now: 0, activeThreadId: null, filter: null }).sections;
  return layoutItems(listItems(sections, view({ open: new Set(open) })), viewport);
}

/** n quiet parents a0 … a{n-1}, the latest first, and one archived thread so Archived stands folded at the foot. */
export function quiet(n: number, change: (t: PluginSidebarThread) => PluginSidebarThread = (t) => t): PluginSidebarThread[] {
  const threads = Array.from({ length: n }, (_, i) => change(thread(`a${i}`, { latestAttentionAt: 100 - i })));
  return [...threads, thread("x", { isArchived: true, archivedAt: 1 })];
}
