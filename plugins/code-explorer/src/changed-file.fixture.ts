import type { ChangedFile } from "./git.ts";

export function changedFile(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    previousPath: null,
    changeKind: "modified",
    origin: "tracked",
    additions: 1,
    deletions: 1,
    binary: false,
    loadMode: "auto",
    revision: `rev-${path}`,
    ...overrides,
  };
}
