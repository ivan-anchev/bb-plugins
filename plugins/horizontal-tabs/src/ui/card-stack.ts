// The cards of a tab's project stack: one per thread pane, so a tab's icon shows whose threads it holds, up
// to three.
import { focused, panes, type Layout } from "../model/layout.ts";

/** Cards past this many add nothing visible, so more panes never widen the tab. */
const MAX_CARDS = 3;

/**
 * The project of each thread pane the index knows, the focused pane's first and the rest in reading order,
 * at most MAX_CARDS. With a non-thread pane focused, the first thread pane leads.
 */
export function stackOf<P>(layout: Layout, projectOf: (projectId: string) => P | undefined): P[] {
  const front = focused(layout);
  const ordered = [front, ...panes(layout).filter((pane) => pane !== front)];
  const projects = ordered.flatMap((pane) => (pane.content.kind === "thread" ? (projectOf(pane.content.projectId) ?? []) : []));
  return projects.slice(0, MAX_CARDS);
}
