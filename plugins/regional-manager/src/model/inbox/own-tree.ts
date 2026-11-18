// The coordinating thread's own checkout. Its rules say it edits no project file unless the user's
// own message asks it to, and bb can't enforce that, so the plugin reads the checkout's working tree
// when each of its turns ends, and wakes it, unseen by the user, when files there changed. The plugin
// knows which files changed, not who changed them or whether the user asked: the thread judges that.
// Nothing here or in what the plugin tells the thread moves, commits, stashes or deletes a file in
// the checkout. This is detection, not a guarantee: a change committed, or made and undone within a
// turn, leaves the tree clean.

/**
 * A read of the working tree: the paths bb's git plugin listed as changed; how many files it counted
 * changed, more than it listed when it caps its list (bb 0.49 lists 200); and the project's default
 * branch as it names it (null: it named none).
 */
export type OwnTree = { files: string[]; fileCount: number; defaultBranch: string | null };

export const CLEAN_TREE: OwnTree = { files: [], fileCount: 0, defaultBranch: null };

/**
 * Whether two reads found the same changed files, as far as they show. why the count too: a capped
 * list can't show whether files past it changed, so there only a different count tells them apart.
 */
export const sameFiles = (a: OwnTree, b: OwnTree): boolean => a.fileCount === b.fileCount && a.files.length === b.files.length && a.files.every((path) => b.files.includes(path));

/** The changed files in words: "1 changed file", "3 changed files"; "at least 201 changed files" when the list was capped, which the plugin never takes for whole. */
export function changedFilesText({ files, fileCount }: OwnTree): string {
  const count = fileCount === 1 ? "1 changed file" : `${fileCount} changed files`;
  return files.length < fileCount ? `at least ${count}` : count;
}
