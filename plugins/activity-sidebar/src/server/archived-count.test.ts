import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHIVED_COUNT_TAG } from "../contract.ts";
import { openArchivedCount } from "./archived-count.ts";

type Row = { parentThreadId: string | null; visibility: "visible" | "hidden"; projectId: string };

const root = (projectId = "prj_a"): Row => ({ parentThreadId: null, visibility: "visible", projectId });
const child = (projectId = "prj_a"): Row => ({ parentThreadId: "thr_parent", visibility: "visible", projectId });
const hidden = (projectId = "prj_a"): Row => ({ parentThreadId: null, visibility: "hidden", projectId });

// bb's list stands in as every row it holds, sliced by page and blind to the filters, so the count's own
// rule is what's tested; `fail` makes the next list call reject.
function harness(rows: Row[]) {
  const calls: string[] = [];
  const invalidated: string[] = [];
  const bb = { rows, fail: false };
  const threads = {
    list: async ({ archived, hasParent, limit, offset }: { archived: true; hasParent: false; limit: number; offset: number }) => {
      calls.push(`archived=${archived} hasParent=${hasParent} limit=${limit} offset=${offset}`);
      if (bb.fail) {
        bb.fail = false;
        throw new Error("bb is down");
      }
      return bb.rows.slice(offset, offset + limit);
    },
  };
  const counter = openArchivedCount({ threads, rpc: { experimental_invalidate: (tags) => void invalidated.push(...tags) } });
  return { counter, calls, invalidated, bb };
}

test("counts the parents the shelf lists, never a subthread or a hidden helper, in all and per project", async () => {
  const { counter, calls } = harness([root("prj_a"), child("prj_a"), root("prj_a"), hidden("prj_a"), child("prj_b"), root("prj_b")]);
  assert.deepEqual(await counter.read(), { total: 3, byProject: { prj_a: 2, prj_b: 1 } });
  assert.deepEqual(calls, ["archived=true hasParent=false limit=500 offset=0"]);
});

test("reads every page until one comes back short", async () => {
  const { counter, calls } = harness(Array.from({ length: 1_203 }, () => root()));
  assert.deepEqual(await counter.read(), { total: 1_203, byProject: { prj_a: 1_203 } });
  assert.deepEqual(
    calls.map((c) => c.split(" ").at(-1)),
    ["offset=0", "offset=500", "offset=1000"],
  );
});

test("the count is kept: reads after it, or alongside it, list nothing more", async () => {
  const { counter, calls } = harness([root()]);
  const [a, b] = await Promise.all([counter.read(), counter.read()]);
  await counter.read();
  assert.deepEqual([a, b], [{ total: 1, byProject: { prj_a: 1 } }, { total: 1, byProject: { prj_a: 1 } }]);
  assert.equal(calls.length, 1);
});

test("a parent archived, unarchived or deleted drops the kept count and invalidates every client's read", async () => {
  const { counter, calls, invalidated, bb } = harness([root()]);
  await counter.read();
  bb.rows = [root(), root("prj_b")];
  counter.changed(root("prj_b"));
  assert.deepEqual(invalidated, [ARCHIVED_COUNT_TAG]);
  assert.deepEqual(await counter.read(), { total: 2, byProject: { prj_a: 1, prj_b: 1 } });
  assert.equal(calls.length, 2);
});

test("a subthread or a hidden helper changing leaves the count and every client alone", async () => {
  const { counter, calls, invalidated } = harness([root()]);
  await counter.read();
  counter.changed(child());
  counter.changed(hidden());
  await counter.read();
  assert.deepEqual(invalidated, []);
  assert.equal(calls.length, 1);
});

test("a change while a count is on its way makes the next read count again", async () => {
  const { counter, calls, bb } = harness([root()]);
  const before = counter.read();
  bb.rows = [root(), root()];
  counter.changed(root());
  assert.deepEqual(await counter.read(), { total: 2, byProject: { prj_a: 2 } });
  await before;
  assert.equal(calls.length, 2);
});

test("a failed count is not kept: the read fails, and the next one counts again", async () => {
  const { counter, bb } = harness([root()]);
  bb.fail = true;
  await assert.rejects(counter.read(), /bb is down/);
  assert.deepEqual(await counter.read(), { total: 1, byProject: { prj_a: 1 } });
});
