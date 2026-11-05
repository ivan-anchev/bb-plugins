import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changeKindOf, type ChangeKind } from "./change-kind.ts";

const EXPECTED: Record<ChangeKind, string[]> = {
  generated: [
    "pnpm-lock.yaml",
    "package-lock.json",
    "Cargo.lock",
    "src/api.gen.ts",
    "foo/__generated__/x.ts",
    "convex/_generated/api.d.ts",
    "dist/app.min.js",
  ],
  mocks: [
    "__snapshots__/a.test.ts.snap",
    "src/user.fixture.ts",
    "__mocks__/fs.ts",
    "test/fixtures/pr.json",
    "src/mockServer.ts",
    "pkg/testdata/input.txt",
  ],
  tests: [
    "src/a.test.tsx",
    "pkg/a_test.go",
    "test_x.py",
    "FooTest.java",
    "src/agent.eval.ts",
    "evals/title-generation.ts",
    "tests/README.md",
    "conftest.py",
  ],
  code: ["Latest.java", "requirements.txt", "src/index.ts", "src/contest.py", "src/mockingbird.ts"],
  docs: ["README.md", "docs/guide.mdx", "CHANGELOG.markdown", "notes.txt"],
};

describe("changeKindOf", () => {
  for (const [kind, paths] of Object.entries(EXPECTED)) {
    for (const path of paths) {
      test(`${path} is ${kind}`, () => {
        assert.equal(changeKindOf(path), kind);
      });
    }
  }

  test("reads Windows separators like forward slashes", () => {
    assert.equal(changeKindOf("src\\__mocks__\\fs.ts"), "mocks");
    assert.equal(changeKindOf("pkg\\tests\\setup.ts"), "tests");
  });

  test("ranks generated over mocks over tests over docs", () => {
    assert.equal(changeKindOf("__generated__/a.test.ts"), "generated");
    assert.equal(changeKindOf("tests/__snapshots__/a.snap"), "mocks");
    assert.equal(changeKindOf("docs/guide.test.md"), "tests");
  });

  test("matches test class names case-sensitively", () => {
    assert.equal(changeKindOf("src/Latest.kt"), "code");
    assert.equal(changeKindOf("src/WidgetTests.swift"), "tests");
  });
});
