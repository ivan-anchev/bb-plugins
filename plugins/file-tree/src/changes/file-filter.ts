import picomatch from "picomatch";
import type { ChangedFile } from "../git.ts";

export type FileFilters = { extensions: readonly string[]; showDeleted: boolean };

type PathMatcher = (path: string) => boolean;

const DESCENDANTS = "\u002f**";

export const NO_FILTERS: FileFilters = { extensions: [], showDeleted: true };

export function filterChangedFiles(
  files: readonly ChangedFile[],
  pathQuery: string | null,
  filters: FileFilters,
): ChangedFile[] {
  return filesMatchingPathQuery(files, pathQuery ?? "").filter(
    (file) =>
      (filters.extensions.length === 0 || filters.extensions.includes(extensionOf(file.path))) &&
      (filters.showDeleted || file.changeKind !== "deleted"),
  );
}

export function withExtensionShown(filters: FileFilters, extension: string, shown: boolean): FileFilters {
  const others = filters.extensions.filter((candidate) => candidate !== extension);
  return { ...filters, extensions: shown ? [...others, extension] : others };
}

export function isFiltering(pathQuery: string | null, filters: FileFilters): boolean {
  return (pathQuery ?? "").trim() !== "" || filters.extensions.length > 0 || !filters.showDeleted;
}

export function extensionCountsOf(files: readonly ChangedFile[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = extensionOf(file.path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right));
}

function filesMatchingPathQuery(files: readonly ChangedFile[], pathQuery: string): ChangedFile[] {
  const terms = pathQuery
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term !== "" && term !== "!");
  const included = terms
    .filter((term) => !term.startsWith("!"))
    .map((term) => {
      const { exact, partial } = matchersOf(term);
      return files.some((file) => touches(file, exact)) ? exact : partial;
    });
  const kept = included.length === 0 ? [...files] : files.filter((file) => included.some((match) => touches(file, match)));
  const excluded = terms
    .filter((term) => term.startsWith("!"))
    .map((term) => matchersOf(term.slice(1)).exact)
    .filter((match) => !kept.every((file) => touches(file, match)));
  return kept.filter((file) => !excluded.some((match) => touches(file, match)));
}

function touches(file: ChangedFile, match: PathMatcher): boolean {
  return match(file.path) || (file.previousPath !== null && match(file.previousPath));
}

function matchersOf(term: string): { exact: PathMatcher; partial: PathMatcher } {
  if (!picomatch.scan(term).isGlob) {
    const needle = term.toLowerCase();
    const contains = (path: string) => path.toLowerCase().includes(needle);
    return { exact: contains, partial: contains };
  }
  const anchored = term.includes("/");
  return {
    exact: globOf(term, !anchored),
    partial: anchored ? globOf([`${term}*`, `${term}*${DESCENDANTS}`], false) : globOf(`${term}*`, true),
  };
}

function globOf(pattern: string | string[], basename: boolean): PathMatcher {
  return picomatch(pattern, { basename, dot: true, nocase: true });
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : "";
}
