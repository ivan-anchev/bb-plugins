// The sidebar as one flat list of items, top to bottom: section titles, rows, the spacer, "Show more",
// notices. Pure. The prototype's Faithful shape (prototype.html `faithful`, `archivedSection`).
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import type { RowModel, Section, SectionKey } from "../model/activity.ts";

export type ListItem =
  /** `count` is how many it holds, said only while folded; null while open. */
  | { kind: "title"; key: `t:${SectionKey}`; section: SectionKey; label: string; open: boolean; count: string | null }
  | { kind: "row"; key: `s:${string}`; row: RowModel }
  /** Fills the room the rest leave, so the shelves after it stand at the view's foot. */
  | { kind: "spacer"; key: "spacer" }
  /** How many more archived rows a press shows; null when only the server knows (no archived count API). */
  | { kind: "more"; key: "more:archived"; n: number | null }
  | { kind: "notice"; key: "n:list" | "n:archived"; text: string; retry: boolean };

export type ListStatus = PluginSidebarThreadsState["status"];

/** The archived pager as the shelf reads it (bb's `experimental_archived`). */
export type ArchivePager = Pick<NonNullable<PluginSidebarThreadsState["experimental_archived"]>, "status" | "hasNextPage" | "isFetchingNextPage" | "isFetchNextPageError">;

/** The reader's view of the sections: what is open, how far Archived is unrolled, what it is narrowed to. */
export type ListView = {
  status: ListStatus;
  open: ReadonlySet<SectionKey>;
  /** Archived rows shown while it is open: 10, then 25 more a press. */
  archivedShown: number;
  archive: ArchivePager;
  /** The project every section is narrowed to, by name; null for every project. */
  filterName: string | null;
};

export const ARCHIVED_FIRST = 10;
export const ARCHIVED_STEP = 25;

const LABEL: Record<SectionKey, string> = { pinned: "Pinned", activity: "Activity", working: "Working", asleep: "Asleep", archived: "Archived" };
const SHELVES = ["working", "asleep", "archived"] as const satisfies readonly SectionKey[];

export function listItems(sections: readonly Section[], view: ListView): ListItem[] {
  if (view.status === "loading") return [listNotice("Loading threads…")];
  if (view.status === "error") return [listNotice("Couldn't load threads")];

  const rows = (key: SectionKey) => sections.find((s) => s.key === key)?.rows ?? [];
  // why: Archived stands while the server holds threads not loaded yet, or its first page failed, so
  // its count ("0+") and Retry stay reachable before any row has loaded.
  const archivedPending = view.archive.hasNextPage || view.archive.status === "error";
  const shelves = SHELVES.filter((key) => rows(key).length > 0 || (key === "archived" && archivedPending));

  // why: Pinned stands only while something is pinned; Activity always stands, empty or not.
  const top: SectionKey[] = rows("pinned").length > 0 ? ["pinned", "activity"] : ["activity"];
  const spacer: ListItem[] = shelves.length > 0 ? [{ kind: "spacer", key: "spacer" }] : [];
  return [...top.flatMap((key) => sectionItems(key, rows(key), view)), ...spacer, ...shelves.flatMap((key) => sectionItems(key, rows(key), view))];
}

// ------------------------------------------------------------------ layer 2

function sectionItems(key: SectionKey, rows: readonly RowModel[], view: ListView): ListItem[] {
  const open = view.open.has(key);
  const label = key === "activity" && view.filterName !== null ? `Activity · ${view.filterName}` : LABEL[key];
  const known = `${rows.length}`;
  const count = open ? null : key === "archived" && view.archive.hasNextPage ? `${known}+` : known;
  const title: ListItem = { kind: "title", key: `t:${key}`, section: key, label, open, count };
  if (!open) return [title];
  if (key === "archived") return [title, ...archivedBody(rows, view)];
  return [title, ...rows.map(rowItem)];
}

/** The first rows shown, then "Show n more", a page loading, or the page that failed with Retry. */
function archivedBody(rows: readonly RowModel[], view: ListView): ListItem[] {
  const shown = rows.slice(0, view.archivedShown).map(rowItem);
  const { archive } = view;
  if (archive.status === "error" || archive.isFetchNextPageError) return [...shown, archivedNotice("Couldn't load archived threads", true)];
  if (archive.isFetchingNextPage) return [...shown, archivedNotice("Loading…", false)];

  const loadedBeyond = rows.length - view.archivedShown;
  if (loadedBeyond >= ARCHIVED_STEP) return [...shown, more(ARCHIVED_STEP)];
  if (archive.hasNextPage) return [...shown, more(null)];
  return loadedBeyond > 0 ? [...shown, more(loadedBeyond)] : shown;
}

function rowItem(row: RowModel): ListItem {
  return { kind: "row", key: `s:${row.thread.id}`, row };
}

function more(n: number | null): ListItem {
  return { kind: "more", key: "more:archived", n };
}

function listNotice(text: string): ListItem {
  return { kind: "notice", key: "n:list", text, retry: false };
}

function archivedNotice(text: string, retry: boolean): ListItem {
  return { kind: "notice", key: "n:archived", text, retry };
}
