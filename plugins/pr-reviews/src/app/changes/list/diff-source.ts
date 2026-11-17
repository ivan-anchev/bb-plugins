// What the Changes tab's list shows for a file (code-explorer's viewer-input notice rules): its
// patch, whether its unchanged lines can expand and whether it starts folded, or a notice where a
// diff would be empty. Pure.
import { fileLineCountsOf, type DiffFile } from "../../../diff/diff-schema.ts";

/**
 * `expandable`: whether the patch leaves out unchanged lines to expand. An added or a deleted
 * file's patch is the whole file. `folded`: why the patch waits for a click to draw, or null.
 */
type DiffSource = { kind: "patch"; expandable: boolean; folded: string | null } | { kind: "notice"; message: string };

export function diffSourceOf(file: DiffFile): DiffSource {
  if (file.binary) return { kind: "notice", message: "Binary file. There is no text diff to show." };
  const { added, removed } = fileLineCountsOf(file);
  if (added + removed === 0) return { kind: "notice", message: unchangedContentsMessageOf(file) };
  return { kind: "patch", expandable: file.status === "modified" || file.status === "renamed", folded: foldedReasonOf(file.path, added + removed) };
}

// Display only: the path is shown as the diff wrote it.
function unchangedContentsMessageOf(file: DiffFile): string {
  return file.previousPath === null ? "No text changes." : `Renamed from ${file.previousPath}. The contents are unchanged.`;
}

// why fold, as GitHub does: a diff draws every one of its rows at once, so a lockfile or a
// thousand-line diff is a long frame for the whole list, and the reader rarely reads either.
// Lockfiles are generated, so they fold at any size.
function foldedReasonOf(path: string, changedLines: number): string | null {
  if (LOCKFILES.has(path.slice(path.lastIndexOf("/") + 1))) return "A generated lockfile. Its diff is not shown by default.";
  if (changedLines > LARGE_DIFF_LINES) return "A large diff. It is not shown by default.";
  return null;
}

const LARGE_DIFF_LINES = 1000;

const LOCKFILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "go.sum",
  "flake.lock",
  "Podfile.lock",
  "pubspec.lock",
  "mix.lock",
  "packages.lock.json",
]);
