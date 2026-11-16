// bb's split layout, verbatim: what a tab holds and what bb keeps in sessionStorage["bb.splitLayout"].
// The schema copies bb 0.49's own (index chunk, the zod schema beside the "bb.splitLayout" key): strict
// objects, row|col splits whose positive sizes match the children and sum to 1, at most 8 panes, unique
// pane ids and a focused pane that exists. bb clamps sizes to [0.15, 0.85] only when it draws them; its
// schema accepts smaller ones, and an 8-pane row is stored as eight 0.125s.
import { z } from "zod";

export type PaneContent =
  | { kind: "thread"; projectId: string; threadId: string }
  | { kind: "new-thread" }
  | { kind: "plugin-panel"; pluginId: string; panelPath: string; subPath: string }
  | { kind: "plugin-detail"; pluginId: string };
export type Pane = { type: "pane"; paneId: string; content: PaneContent };
export type Split = { type: "split"; dir: "row" | "col"; sizes: number[]; children: LayoutNode[] };
export type LayoutNode = Pane | Split;
export type Layout = { root: LayoutNode; focusedPaneId: string };

const MAX_PANES = 8;
const SUM_TOLERANCE = 1e-9;

const paneContentSchema: z.ZodType<PaneContent> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("thread"), projectId: z.string().min(1), threadId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("new-thread") }),
  z.strictObject({
    kind: z.literal("plugin-panel"),
    pluginId: z.string().min(1),
    panelPath: z.string().min(1),
    subPath: z.string(),
  }),
  z.strictObject({ kind: z.literal("plugin-detail"), pluginId: z.string().min(1) }),
]);

const paneSchema: z.ZodType<Pane> = z.strictObject({
  type: z.literal("pane"),
  paneId: z.string().min(1),
  content: paneContentSchema,
});

const nodeSchema: z.ZodType<LayoutNode> = z.lazy(() => z.union([paneSchema, splitSchema]));

const splitSchema: z.ZodType<Split> = z
  .strictObject({
    type: z.literal("split"),
    dir: z.enum(["row", "col"]),
    sizes: z.array(z.number().positive()),
    children: z.array(nodeSchema).min(2),
  })
  .refine((split) => split.sizes.length === split.children.length, "Split sizes must match its child count")
  .refine((split) => Math.abs(sum(split.sizes) - 1) <= SUM_TOLERANCE, "Split sizes must sum to 1");

export const layoutSchema: z.ZodType<Layout> = z
  .strictObject({ root: nodeSchema, focusedPaneId: z.string().min(1) })
  .refine((layout) => panes(layout).length <= MAX_PANES, `A split layout supports at most ${MAX_PANES} panes`)
  .refine((layout) => panes(layout).some((pane) => pane.paneId === layout.focusedPaneId), "The focused pane must exist")
  .refine((layout) => new Set(panes(layout).map((pane) => pane.paneId)).size === panes(layout).length, "Pane IDs must be unique");

/** Every pane, in reading order. */
export function panes(layout: Layout): Pane[] {
  return leaves(layout.root);
}

/** The pane bb marks focused. A parsed layout always has it (layoutSchema). */
export function focused(layout: Layout): Pane {
  return panes(layout).find((pane) => pane.paneId === layout.focusedPaneId)!;
}

/** `layout` with pane `paneId`, one of its own, focused. */
export function withFocus(layout: Layout, paneId: string): Layout {
  return { ...layout, focusedPaneId: paneId };
}

/** One pane showing `content`. */
export function single(content: PaneContent, paneId: string): Layout {
  return { root: { type: "pane", paneId, content }, focusedPaneId: paneId };
}

/**
 * `layout` with every pane id that `other` also uses renamed to a fresh `<prefix>-<n>`, the focus following
 * its pane. why: bb keeps a maximized pane by id, so a tab shown with an id the outgoing layout used would
 * inherit its maximize; with no shared id bb treats every pane as new and maximizes none.
 */
export function withPaneIdsApart(layout: Layout, other: Layout | null, prefix: string): Layout {
  const ids = panes(layout).map((pane) => pane.paneId);
  const theirs = new Set(other === null ? [] : panes(other).map((pane) => pane.paneId));
  const taken = new Set([...ids, ...theirs]);
  const renamed = new Map<string, string>();
  for (const id of ids.filter((id) => theirs.has(id))) {
    let n = 1;
    while (taken.has(`${prefix}-${n}`)) n += 1;
    renamed.set(id, `${prefix}-${n}`);
    taken.add(`${prefix}-${n}`);
  }
  const rename = (id: string) => renamed.get(id) ?? id;
  return { root: mapPanes(layout.root, (pane) => ({ ...pane, paneId: rename(pane.paneId) })), focusedPaneId: rename(layout.focusedPaneId) };
}

function leaves(node: LayoutNode): Pane[] {
  return node.type === "pane" ? [node] : node.children.flatMap(leaves);
}

function mapPanes(node: LayoutNode, map: (pane: Pane) => Pane): LayoutNode {
  return node.type === "pane" ? map(node) : { ...node, children: node.children.map((child) => mapPanes(child, map)) };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
