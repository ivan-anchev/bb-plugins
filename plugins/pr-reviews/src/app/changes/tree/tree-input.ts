// The Changes tab's file tree input (ported from code-explorer's tree-input): tree paths, git
// status and icons for @pierre/trees from the PR's changed files, and row decorations, each file's
// `+N −M` and its review-thread mark, from those and the PR's threads. Pure.
import {
  createFileTreeIconResolver,
  type FileTreeIconConfig,
  type FileTreeRowDecoration,
  type GitStatusEntry,
} from "@pierre/trees";
import type { ReviewThread } from "../../../comments/thread-schema.ts";
import type { DiffFile } from "../../../diff/diff-schema.ts";
import { fileStatPartsOf, plainTextOf, type StatPart } from "../change-stats.ts";
import { threadMarksOf, type ThreadMark } from "./thread-marks.ts";

export type RowDecorations = ReadonlyMap<string, FileTreeRowDecoration>;

type ChangesTreeInput = {
  paths: string[];
  gitStatus: GitStatusEntry[];
  icons: FileTreeIconConfig;
  filesByTreePath: ReadonlyMap<string, DiffFile>;
};

const TREE_ICONS: FileTreeIconConfig = {
  set: "complete",
  colored: true,
  byFileName: {
    "package.json": "file-tree-builtin-npm",
    "tsconfig.json": "file-tree-builtin-typescript",
  },
};

const treeIconResolver = createFileTreeIconResolver(TREE_ICONS);

const ZERO_WIDTH_SPACE = "\u200b";

const NO_BREAK_SPACE = "\u00a0";

const STAT_COLORS: Record<StatPart["tone"], string> = {
  added: "var(--diff-added)",
  removed: "var(--diff-removed)",
  muted: "var(--muted-foreground)",
};

export function changesTreeOf(files: readonly DiffFile[]): ChangesTreeInput {
  const filesByTreePath = filesByTreePathOf(files);
  const entries = [...filesByTreePath];

  return {
    paths: [...filesByTreePath.keys()],
    // A PR file's status is one of the tree's git statuses.
    gitStatus: entries.map(([path, file]) => ({ path, status: file.status })),
    icons: iconsKeepingOriginalNames(entries.filter(([treePath, file]) => treePath !== file.path)),
    filesByTreePath,
  };
}

/** Each row's decoration: its file's line stats, then its review-thread mark. */
export function rowDecorationsOf(filesByTreePath: ReadonlyMap<string, DiffFile>, threads: readonly ReviewThread[]): RowDecorations {
  const marks = threadMarksOf(threads, filesByTreePath);
  return new Map([...filesByTreePath].flatMap(([path, file]) => decorationOf(path, file, marks.get(path))));
}

/** Each file by its tree path: its own, unless it collides with a folder's. */
export function filesByTreePathOf(files: readonly DiffFile[]): Map<string, DiffFile> {
  const directories = new Set(files.flatMap((file) => ancestorDirectoriesOf(file.path)));
  const takenPaths = new Set([...directories, ...files.map((file) => file.path)]);
  return new Map(
    files.map((file) => [directories.has(file.path) ? claimUnusedPath(file.path, takenPaths) : file.path, file]),
  );
}

function ancestorDirectoriesOf(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function claimUnusedPath(path: string, takenPaths: Set<string>): string {
  let candidate = `${path}${ZERO_WIDTH_SPACE}`;
  while (takenPaths.has(candidate)) candidate += ZERO_WIDTH_SPACE;
  takenPaths.add(candidate);
  return candidate;
}

function iconsKeepingOriginalNames(renamed: readonly [string, DiffFile][]): FileTreeIconConfig {
  const iconsByTreeName = renamed.map(([treePath, file]) => [
    baseNameOf(treePath),
    treeIconResolver.resolveIcon("file-tree-icon-file", file.path),
  ]);
  return { ...TREE_ICONS, byFileName: { ...TREE_ICONS.byFileName, ...Object.fromEntries(iconsByTreeName) } };
}

// The mark comes last, so the marks of a column of rows line up against the git status. Its stylesheet
// spaces it from the stats (thread-marks.ts).
function decorationOf(path: string, file: DiffFile, mark: ThreadMark | undefined): [string, FileTreeRowDecoration][] {
  const stats = fileStatPartsOf(file);
  const statParts = stats.flatMap((part, index) => [
    ...(index === 0 ? [] : [{ text: NO_BREAK_SPACE }]),
    { text: part.text, color: STAT_COLORS[part.tone] },
  ]);
  const parts = [...statParts, ...(mark === undefined ? [] : [mark.part])];
  if (parts.length === 0) return [];
  const title = [...(stats.length === 0 ? [] : [plainTextOf(stats)]), ...(mark === undefined ? [] : [mark.title])].join(" · ");
  return [[path, { text: title, title, parts }]];
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
