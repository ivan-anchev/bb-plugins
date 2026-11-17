import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DiffFile } from "../../../diff/diff-schema.ts";
import { diffSourceOf } from "./diff-source.ts";
import { diffFile } from "../diff-file.fixture.ts";

describe("diffSourceOf", () => {
  test("shows the file's patch", () => {
    assert.deepEqual(diffSourceOf(diffFile("src/a.ts", { added: 1, removed: 1 })), { kind: "patch", expandable: true, folded: null });
  });

  test("a modified or renamed file's unchanged lines can expand; an added or deleted file's patch is all of it", () => {
    const expandable = (status: DiffFile["status"]) => {
      const source = diffSourceOf(diffFile("src/a.ts", { status, previousPath: status === "renamed" ? "src/b.ts" : null }));
      return source.kind === "patch" && source.expandable;
    };

    assert.deepEqual((["modified", "renamed", "added", "deleted"] as const).map(expandable), [true, true, false, false]);
  });

  test("shows a notice instead of a diff for binary files", () => {
    assert.deepEqual(diffSourceOf(diffFile("logo.png", { binary: true, added: 0, removed: 0 })), {
      kind: "notice",
      message: "Binary file. There is no text diff to show.",
    });
  });

  test("says a pure rename has unchanged contents instead of showing an empty diff", () => {
    const file = diffFile("lib/new.ts", { status: "renamed", previousPath: "lib/old.ts", added: 0, removed: 0 });

    assert.deepEqual(diffSourceOf(file), { kind: "notice", message: "Renamed from lib/old.ts. The contents are unchanged." });
  });

  test("says there are no text changes when no lines changed", () => {
    const file = diffFile("empty.txt", { status: "added", added: 0, removed: 0 });

    assert.deepEqual(diffSourceOf(file), { kind: "notice", message: "No text changes." });
  });

  test("folds a lockfile at any size, and any other file over a thousand changed lines", () => {
    const folded = (path: string, added: number) => {
      const source = diffSourceOf(diffFile(path, { added, removed: 0 }));
      return source.kind === "patch" && source.folded !== null;
    };

    assert.deepEqual(
      [folded("pnpm-lock.yaml", 3), folded("apps/web/package-lock.json", 3), folded("src/big.ts", 1000), folded("src/big.ts", 1001), folded("src/pnpm-lock.yaml.ts", 3)],
      [true, true, false, true, false],
    );
  });
});
