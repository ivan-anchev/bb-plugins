import {
  createFileTreeIconResolver,
  prepareFileTreeInput,
  type FileTreeIconConfig,
  type FileTreeRowDecoration,
  type GitStatusEntry,
} from "@pierre/trees";
import type { DiffFile } from "../../../diff/diff-schema.ts";
import { fileStatPartsOf, plainTextOf, type StatPart } from "../change-stats.ts";

export type RowDecorations = ReadonlyMap<string, FileTreeRowDecoration>;

/** A changed file, with its path in the tree. */
export type TreeFile = { treePath: string; file: DiffFile };

type ChangesTreeInput = {
  paths: string[];
  gitStatus: GitStatusEntry[];
  icons: FileTreeIconConfig;
  decorations: RowDecorations;
  filesByTreePath: ReadonlyMap<string, DiffFile>;
  /** The files in the order the tree lists them. */
  inTreeOrder: readonly TreeFile[];
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
    gitStatus: entries.map(([path, file]) => ({ path, status: file.status })),
    icons: iconsKeepingOriginalNames(entries.filter(([treePath, file]) => treePath !== file.path)),
    decorations: new Map(entries.flatMap(([path, file]) => statDecorationOf(path, file))),
    filesByTreePath,
    inTreeOrder: inTreeOrderOf(filesByTreePath),
  };
}

function inTreeOrderOf(filesByTreePath: ReadonlyMap<string, DiffFile>): TreeFile[] {
  const { paths } = prepareFileTreeInput([...filesByTreePath.keys()], { flattenEmptyDirectories: true });
  return paths.map((treePath) => ({ treePath, file: filesByTreePath.get(treePath)! }));
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

function statDecorationOf(path: string, file: DiffFile): [string, FileTreeRowDecoration][] {
  const parts = fileStatPartsOf(file);
  if (parts.length === 0) return [];
  const coloredParts = parts.flatMap((part, index) => [
    ...(index === 0 ? [] : [{ text: NO_BREAK_SPACE }]),
    { text: part.text, color: STAT_COLORS[part.tone] },
  ]);
  return [[path, { text: plainTextOf(parts), title: plainTextOf(parts), parts: coloredParts }]];
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
