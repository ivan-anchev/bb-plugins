// Test views: every section open unless a test says otherwise, every archived thread loaded.
import type { SectionKey } from "../model/activity.ts";
import type { ArchivePager, ListView } from "./items.ts";

export const LOADED: ArchivePager = { status: "ready", hasNextPage: false, isFetchingNextPage: false, isFetchNextPageError: false };

export function view(overrides: Partial<ListView> = {}): ListView {
  const open: SectionKey[] = ["pinned", "activity", "working", "asleep", "archived"];
  return { status: "ready", open: new Set(open), archivedShown: 10, archive: LOADED, filterName: null, ...overrides };
}
