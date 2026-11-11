import assert from "node:assert/strict";
import { test } from "node:test";
import { repoSchema } from "./repo.ts";
import { commentApiArgs, conversationCommentApiArgs, replyApiArgs } from "./comment-args.ts";

const REPO = repoSchema.parse("ivan-anchev/bb-plugins");
const COMMIT = "3f9c2ab0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6";
const ENDPOINT = ["api", "--method", "POST", "repos/ivan-anchev/bb-plugins/pulls/41/comments"];

test("one line: line and side, no start and no subject_type, integers by -F and the rest by -f", () => {
  const args = commentApiArgs(REPO, 41, { kind: "line", commit: COMMIT, path: "src/a.ts", start: null, end: { side: "new", line: 12 }, body: "Why?" });

  assert.deepEqual(args, [...ENDPOINT, "-f", "body=Why?", "-f", `commit_id=${COMMIT}`, "-f", "path=src/a.ts", "-F", "line=12", "-f", "side=RIGHT"]);
});

test("a range from a removed line to an added one: start_line and start_side LEFT, line and side RIGHT", () => {
  const args = commentApiArgs(REPO, 41, { kind: "line", commit: COMMIT, path: "src/a.ts", start: { side: "old", line: 3 }, end: { side: "new", line: 5 }, body: "Range" });

  assert.deepEqual(args, [
    ...ENDPOINT,
    ...["-f", "body=Range", "-f", `commit_id=${COMMIT}`, "-f", "path=src/a.ts"],
    ...["-F", "start_line=3", "-f", "start_side=LEFT", "-F", "line=5", "-f", "side=RIGHT"],
  ]);
});

test("a file comment: no line fields, subject_type file", () => {
  const args = commentApiArgs(REPO, 41, { kind: "file", commit: COMMIT, path: "docs/x.md", body: "Quoted" });

  assert.deepEqual(args, [...ENDPOINT, "-f", "body=Quoted", "-f", `commit_id=${COMMIT}`, "-f", "path=docs/x.md", "-f", "subject_type=file"]);
});

test("text that -F would read as a file or a number goes by -f, whole, as one argument each", () => {
  const body = "@octocat look:\n```diff\n+x\n```";
  const args = commentApiArgs(REPO, 41, { kind: "file", commit: COMMIT, path: "123", body });

  assert.deepEqual(args.slice(4, 6), ["-f", `body=${body}`]);
  assert.deepEqual(args.slice(8, 10), ["-f", "path=123"]);
  assert.deepEqual(args.flatMap((arg, index) => (arg === "-F" ? [args[index + 1]] : [])), []);
});

test("a reply: the thread's first comment in the path, the body by -f and nothing else", () => {
  const body = "@octocat > quoted\n\nAgreed.";
  assert.deepEqual(replyApiArgs(REPO, 41, 2512345678, body), ["api", "--method", "POST", "repos/ivan-anchev/bb-plugins/pulls/41/comments/2512345678/replies", "-f", `body=${body}`]);
});

test("a conversation comment goes to the PR's issue, the body by -f and nothing else", () => {
  const body = "> Looks good\n\nThanks!";
  assert.deepEqual(conversationCommentApiArgs(REPO, 41, body), ["api", "--method", "POST", "repos/ivan-anchev/bb-plugins/issues/41/comments", "-f", `body=${body}`]);
});
