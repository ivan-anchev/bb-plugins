import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { filePathOfLink, filePathOfMention } from "./chat-file-targets.ts";

describe("filePathOfLink", () => {
  test("reads the path of a file link without its line anchor", () => {
    assert.equal(filePathOfLink("file:///Users/me/repo/src/app.ts#L12-L20"), "/Users/me/repo/src/app.ts");
  });

  test("decodes escaped characters in the path", () => {
    assert.equal(filePathOfLink("file:///Users/me/my%20repo/read%20me.md"), "/Users/me/my repo/read me.md");
  });

  test("keeps a Windows drive path readable", () => {
    assert.equal(filePathOfLink("file:///C:/repo/main.go"), "/C:/repo/main.go");
  });

  test("ignores links that are not files", () => {
    assert.equal(filePathOfLink("https://example.com/app.ts"), null);
    assert.equal(filePathOfLink("file:///Users/me/repo/"), null);
    assert.equal(filePathOfLink("not a url"), null);
  });
});

describe("filePathOfMention", () => {
  const mention = (fields: Record<string, unknown>) =>
    JSON.stringify({ kind: "path", label: "app.ts", source: "workspace", ...fields });

  test("reads the path of a file mention", () => {
    assert.equal(filePathOfMention(mention({ entryKind: "file", path: "src/app.ts" })), "src/app.ts");
  });

  test("ignores folder mentions", () => {
    assert.equal(filePathOfMention(mention({ entryKind: "directory", path: "src" })), null);
  });

  test("ignores other mention kinds and malformed attributes", () => {
    assert.equal(filePathOfMention(JSON.stringify({ kind: "thread", threadId: "thr_1", label: "Fix" })), null);
    assert.equal(filePathOfMention("{not json"), null);
  });
});
