// The coordinating thread's own working tree. Its rules say it edits no project file unless the
// user's own message asks it to, and bb can't enforce that, so the plugin reads the tree when each
// of its turns ends. Files changed there that the user didn't ask for are a draft: the plugin tells
// only the thread, which saves it on a branch of its own and hands it to an agent. This is
// detection, not a guarantee: a change it committed, or one made and undone within a turn, leaves
// the tree clean, and a kept file changed again is not seen.
import type { CoordinatorId } from "../role.ts";

/**
 * What the plugin remembers of the tree: `kept`, the changed files the thread kept, saying the user
 * asked it to change them (keep_edits); `drafted`, the other changed files the latest read found,
 * which the thread was told of once.
 */
export type OwnTree = { kept: string[]; drafted: string[] };

export const CLEAN_TREE: OwnTree = { kept: [], drafted: [] };

/**
 * What a turn-end read of the `changed` files does to `tree`: the tree as remembered after it, and
 * the draft to tell the thread of (null: none, or the same one it was told of). A kept file no longer
 * changed is forgotten, so a later change to it is a draft again.
 */
export function afterTurn(tree: OwnTree, changed: readonly string[]): { tree: OwnTree; draft: string[] | null } {
  const kept = tree.kept.filter((path) => changed.includes(path));
  const unasked = changed.filter((path) => !kept.includes(path));
  const told = unasked.length === tree.drafted.length && unasked.every((path) => tree.drafted.includes(path));
  return { tree: { kept, drafted: unasked }, draft: unasked.length === 0 || told ? null : unasked };
}

/** The tree once the thread kept every file `changed` now, as keep_edits does. */
export const keptAll = (changed: readonly string[]): OwnTree => ({ kept: [...changed], drafted: [] });

/** The branch a draft found `at` is saved on: one per draft, so no two drafts share one. */
export const draftBranch = (id: CoordinatorId, at: number): string => `regional-manager/${id.slice(0, 8)}/draft-${at.toString(36)}`;

/** A count of changed files, in words: "1 file", "3 files". */
export const filesText = (count: number): string => (count === 1 ? "1 file" : `${count} files`);
