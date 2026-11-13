import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread, WORKING } from "../model/fixtures.ts";
import { indexThreads } from "../model/thread-index.ts";
import { checkoutOf, subthreadLines, type TreeLine } from "./subthread-tree.ts";

type Env = NonNullable<PluginSidebarThread["environment"]>;

function env(id: string, branchName: string | null, isWorktree: boolean): Env {
  return { id, name: id, branchName, path: null, isWorktree, providerId: null, workspaceDisplayKind: null };
}

const MAIN = env("env_main", "main", false);
const DONE = { indicator: "unread-success" } as const;
const ASKING = { indicator: "waiting-for-input", hasPendingInteraction: true } as const;

/** A subthread of `parent` in `environment`, moved at `at`. */
function kid(id: string, parent: string, at: number, extra: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return thread(id, { parentThreadId: parent, environment: MAIN, latestAttentionAt: at, ...extra });
}

function tree(threads: PluginSidebarThread[]) {
  const root = thread("root", { environment: MAIN });
  return subthreadLines(indexThreads([root, ...threads]), root);
}

/** Each line as "id" for a thread or "@branch×threads" for a place, indented one space per trunk. */
function shape(lines: readonly TreeLine[]): string[] {
  return lines.map((l) => (l.kind === "thread" ? l.thread.id : `@${l.checkout.branch}×${l.threads}`));
}

test("checkoutOf: a worktree, a plain checkout on a branch, else a workspace", () => {
  assert.deepEqual(checkoutOf(thread("w", { environment: env("e1", "feat", true) })), { kind: "worktree", branch: "feat" });
  assert.deepEqual(checkoutOf(thread("c", { environment: MAIN })), { kind: "checkout", branch: "main" });
  assert.deepEqual(checkoutOf(thread("n", { environment: env("e2", null, false) })), { kind: "workspace", branch: null });
  assert.deepEqual(checkoutOf(thread("x")), { kind: "workspace", branch: null });
});

test("its own checkout's subthreads hang off it; other checkouts merge by kind and branch under one head", () => {
  const t = tree([
    kid("own", "root", 5),
    kid("wt1", "root", 4, { environment: env("env_w1", "feat", true) }),
    kid("wt2", "root", 9, { environment: env("env_w2", "feat", true) }),
    kid("other", "root", 3, { environment: env("env_c", "fix", false) }),
  ]);
  assert.deepEqual(shape(t.lines), ["own", "@feat×2", "wt2", "wt1", "@fix×1", "other"]);
  const feat = t.lines[1];
  assert.equal(feat.kind === "place" && feat.checkouts, 2, "two worktrees on one branch are one place, said once");
  assert.equal(feat.kind === "place" && feat.checkout.kind, "worktree");
});

test("in a state first, most pressing first, then the latest; of the quiet only the two latest", () => {
  const t = tree([
    kid("quiet-old", "root", 1),
    kid("done", "root", 8, DONE),
    kid("quiet-new", "root", 7),
    kid("working", "root", 2, WORKING),
    kid("asking", "root", 3, ASKING),
    kid("quiet-mid", "root", 4),
  ]);
  assert.deepEqual(shape(t.lines), ["asking", "working", "done", "quiet-new", "quiet-mid"]);
  assert.equal(t.total, 6);
  assert.equal(t.hidden, 1);
  assert.equal(t.running, 1);
});

test("a quiet subthread with a busy one below it is kept, with the path to it", () => {
  const t = tree([kid("q1", "root", 9), kid("q2", "root", 8), kid("path", "root", 1), kid("deep", "path", 1, WORKING), kid("deep-quiet", "path", 0)]);
  assert.deepEqual(shape(t.lines), ["path", "deep", "deep-quiet", "q1", "q2"]);
  assert.equal(t.running, 1, "a running grandchild counts");
  assert.equal(t.total, 5);
});

test("twelve lines at most; the rest are counted as hidden", () => {
  const t = tree(Array.from({ length: 15 }, (_, i) => kid(`w${i}`, "root", 100 - i, WORKING)));
  assert.equal(t.lines.length, 12);
  assert.equal(t.total, 15);
  assert.equal(t.hidden, 3);
  assert.equal(t.running, 15);
});

test("a place head left last by the cut goes with its rows", () => {
  const own = Array.from({ length: 11 }, (_, i) => kid(`w${i}`, "root", 100 - i, WORKING));
  const t = tree([...own, kid("far", "root", 1, { environment: env("env_w", "feat", true) })]);
  assert.equal(t.lines.length, 11);
  assert.ok(t.lines.every((l) => l.kind === "thread"));
  assert.equal(t.hidden, 1);
});

test("rails: each level hangs 18 further in; a trunk runs on through its earlier siblings' subtrees", () => {
  const t = tree([kid("a", "root", 9), kid("a1", "a", 1), kid("b", "root", 8), kid("wt", "root", 7, { environment: env("env_w", "feat", true) })]);
  const rail = (l: TreeLine) => [l.at, l.indent, l.last, l.through];
  assert.deepEqual(t.lines.map(rail), [
    [6, 14, false, []], // a
    [24, 32, true, [6]], // a1, under a; the root trunk runs on past it
    [6, 14, false, []], // b
    [6, 14, true, []], // @feat, the root trunk ends here
    [24, 32, true, []], // wt, under the head
  ]);
});

test("hidden and archived subthreads are not in the tree", () => {
  const t = tree([kid("seen", "root", 1), kid("helper", "root", 2, { isHidden: true }), kid("gone", "root", 3, { isArchived: true })]);
  assert.deepEqual(shape(t.lines), ["seen"]);
  assert.equal(t.total, 1);
});
