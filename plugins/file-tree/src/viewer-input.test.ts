import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChangesInput } from "./git.ts";
import { changedFile } from "./changed-file.fixture.ts";
import { diffSourceOf, sourceViewOf } from "./viewer-input.ts";

const uncommitted: ChangesInput = { environmentId: "env-1", target: { type: "uncommitted" }, ignoreWhitespace: false };

describe("diffSourceOf", () => {
  test("uses the patch that came with the file list", () => {
    const patch = { path: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", truncated: false };

    assert.deepEqual(diffSourceOf(changedFile("src/a.ts"), [patch], uncommitted), { kind: "patch", patch });
  });

  test("fetches the patch by key when the file list has none for the file", () => {
    const file = changedFile("src/big.ts", { loadMode: "on_demand", revision: "r7" });
    const other = { path: "src/a.ts", patch: "@@", truncated: false };

    assert.deepEqual(diffSourceOf(file, [other], uncommitted), {
      kind: "fetch",
      patchKey: '["env-1",{"type":"uncommitted"},false,"src/big.ts","r7"]',
    });
  });

  test("keys the fetched patch by the files query and the file's revision", () => {
    const input: ChangesInput = {
      environmentId: "env-1",
      target: { type: "all", mergeBaseBranch: "main" },
      ignoreWhitespace: true,
    };
    const file = changedFile("src/a.ts", { loadMode: "on_demand", revision: "abc" });

    assert.deepEqual(diffSourceOf(file, [], input), {
      kind: "fetch",
      patchKey: '["env-1",{"type":"all","mergeBaseBranch":"main"},true,"src/a.ts","abc"]',
    });
  });

  test("shows a notice instead of a diff for binary files", () => {
    const source = diffSourceOf(changedFile("logo.png", { binary: true }), [], uncommitted);

    assert.equal(source.kind, "notice");
  });

  test("shows the changed line count for files too large to diff", () => {
    const file = changedFile("data.json", { loadMode: "too_large", additions: 90000, deletions: 10 });

    assert.deepEqual(diffSourceOf(file, [], uncommitted), {
      kind: "notice",
      message: "Too large to display (90010 changed lines).",
    });
  });

  test("says a pure rename has unchanged contents instead of fetching an empty diff", () => {
    const file = changedFile("lib/new.ts", {
      changeKind: "renamed",
      previousPath: "lib/old.ts",
      additions: 0,
      deletions: 0,
    });

    assert.deepEqual(diffSourceOf(file, [], uncommitted), {
      kind: "notice",
      message: "Renamed from lib/old.ts. The contents are unchanged.",
    });
  });

  test("says there are no text changes when no lines changed", () => {
    const file = changedFile("empty.txt", { changeKind: "added", additions: 0, deletions: 0 });

    assert.deepEqual(diffSourceOf(file, [], uncommitted), { kind: "notice", message: "No text changes." });
  });
});

describe("sourceViewOf", () => {
  test("shows text files as source", () => {
    assert.deepEqual(sourceViewOf({ content: "hello", contentEncoding: "utf8", sizeBytes: 5 }), {
      kind: "source",
      content: "hello",
    });
  });

  test("shows a notice for binary files", () => {
    assert.equal(sourceViewOf({ content: "AAAA", contentEncoding: "base64", sizeBytes: 3 }).kind, "notice");
  });

  test("shows text files of exactly 1 MB as source", () => {
    assert.equal(sourceViewOf({ content: "x", contentEncoding: "utf8", sizeBytes: 1_048_576 }).kind, "source");
  });

  test("shows a notice for text files over 1 MB", () => {
    assert.deepEqual(sourceViewOf({ content: "x", contentEncoding: "utf8", sizeBytes: 1_048_577 }), {
      kind: "notice",
      message: "Too large to display (1.0 MB).",
    });
  });
});
