// The sidebar as one flat list of items, top to bottom: section titles, rows, notices. Pure.
import type { RowModel, Section, SectionKey } from "../model/activity.ts";

export type ListItem =
  | { kind: "title"; key: `t:${SectionKey}`; label: string }
  | { kind: "row"; key: `s:${string}`; row: RowModel }
  /** Fills the room the rest leave, so what follows it stands at the view's foot. */
  | { kind: "spacer"; key: "spacer" }
  | { kind: "notice"; key: "notice"; text: string };

export type ListStatus = "error" | "loading" | "ready";

const LABEL: Record<SectionKey, string> = { pinned: "Pinned", activity: "Activity" };

export function listItems(sections: readonly Section[], status: ListStatus): ListItem[] {
  if (status === "loading") return [{ kind: "notice", key: "notice", text: "Loading threads…" }];
  if (status === "error") return [{ kind: "notice", key: "notice", text: "Couldn't load threads" }];
  // why: Pinned shows only while something is pinned; Activity always stands, empty or not.
  return sections.filter((s) => s.key === "activity" || s.rows.length > 0).flatMap(sectionItems);
}

function sectionItems(section: Section): ListItem[] {
  return [{ kind: "title", key: `t:${section.key}`, label: LABEL[section.key] }, ...section.rows.map(rowItem)];
}

function rowItem(row: RowModel): ListItem {
  return { kind: "row", key: `s:${row.thread.id}`, row };
}
