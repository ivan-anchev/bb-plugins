import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { MANAGER_LINES_TAG } from "../../contract.ts";
import { openManagerLines } from "./manager-lines.ts";

// bb's events as a list per thread, answering `events.list` as bb does: only the types asked for,
// newest first before `beforeSeq` or oldest first after `afterSeq`, at most `limit`, each row a copy.
// The open managers are the threads bb holds unarchived; `failing` makes the next events read fail.

type Row = { seq: number; type: string; data: unknown };

const reply = (seq: number, text: string, extra: Record<string, unknown> = {}): Row => ({ seq, type: "item/completed", data: { item: { type: "agentMessage", id: `i${seq}`, text, ...extra } } });
const toolCall = (seq: number): Row => ({ seq, type: "item/completed", data: { item: { type: "toolCall", id: `i${seq}`, server: "bb", tool: "issue_create", arguments: {}, result: "Created. Done." } } });
const commandRun = (seq: number): Row => ({ seq, type: "item/completed", data: { item: { type: "commandExecution", id: `i${seq}`, command: "ls", aggregatedOutput: "Output. More." } } });
/** A user's (or the Regional Manager plugin's wake) message: the turn it requests, and the user message item it completes. */
const userMessage = (seq: number): Row[] => [
  { seq, type: "client/turn/requested", data: { input: [{ type: "text", text: "[Regional Manager] Wake up. Check the board." }] } },
  { seq: seq + 1, type: "item/completed", data: { item: { type: "userMessage", id: `i${seq + 1}`, content: [{ type: "text", text: "[Regional Manager] Wake up. Check the board." }] } } },
];
const toolCalls = (from: number, count: number): Row[] => Array.from({ length: count }, (_, at) => toolCall(from + at));

type Held = { events: Row[]; archived?: boolean };

/** A read again after a failure: the first, then each later one (manager-lines.ts RETRY_MS). */
const RETRIES = [2_000, 5_000, 15_000];

afterEach(() => mock.timers.reset());

function harness(held: Record<string, Held>) {
  const invalidated: string[] = [];
  const reads: { threadId: string; afterSeq?: string; beforeSeq?: string }[] = [];
  let failing = 0;
  const lines = openManagerLines({
    threads: {
      list: async ({ threadIds, archived }) => threadIds.filter((id) => held[id] !== undefined && (held[id].archived ?? false) === archived).map((id) => ({ id })),
      events: {
        list: async ({ threadId, types, order, afterSeq, beforeSeq, limit }) => {
          reads.push({ threadId, afterSeq, beforeSeq });
          if (failing > 0) {
            failing -= 1;
            throw new Error("HTTP 503: bb is busy");
          }
          const rows = held[threadId].events.filter((row) => types.some((type) => type === row.type));
          const picked = order === "asc" ? rows.filter((row) => row.seq > Number(afterSeq ?? 0)) : rows.filter((row) => beforeSeq === undefined || row.seq < Number(beforeSeq)).reverse();
          return structuredClone(picked.slice(0, Number(limit)));
        },
      },
    },
    rpc: { experimental_invalidate: (tags) => void invalidated.push(...tags) },
    log: { warn: () => {} },
  });
  // why setImmediate: tests that mock setTimeout still let pending reads settle.
  const settled = () => new Promise((resolve) => setImmediate(resolve));
  const failNext = (times = 1) => {
    failing = times;
  };
  return { lines, invalidated, reads, settled, failNext };
}

test("a manager's line is the first sentence of its latest own reply with text: tool calls, results, empty replies, subagents' replies and user messages are skipped", async () => {
  const { lines } = harness({
    thr_pr: {
      events: [
        reply(1, "An older reply. Not this one."),
        reply(2, "**Two** pull requests [wait](https://x.test/pulls) on you. The rest are green."),
        toolCall(3),
        commandRun(4),
        reply(5, "   "),
        reply(6, "A subagent's finding. Not the manager's.", { parentToolCallId: "i3" }),
        ...userMessage(7),
      ],
    },
  });
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [{ threadId: "thr_pr", line: "Two pull requests wait on you." }] });
});

test("a manager with no such reply has no line, so its row shows its name alone; one not open has none either", async () => {
  const { lines } = harness({ thr_new: { events: [...userMessage(1), toolCall(3), reply(4, "")] }, thr_empty: { events: [] }, thr_gone: { events: [reply(1, "Archived.")], archived: true } });
  assert.deepEqual(await lines.read({ threadIds: ["thr_new", "thr_empty", "thr_gone"] }), { lines: [] });
});

test("the latest reply is found however many items follow it", async () => {
  const { lines } = harness({ thr_pr: { events: [reply(1, "Found it."), ...toolCalls(2, 450)] } });
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [{ threadId: "thr_pr", line: "Found it." }] });
});

test("as a manager's thread moves, only its items since are read, and a new reply changes its line and refreshes every client", async () => {
  const held = { thr_pr: { events: [reply(1, "First."), toolCall(2)] } };
  const { lines, invalidated, reads, settled } = harness(held);
  await lines.read({ threadIds: ["thr_pr"] });

  held.thr_pr.events.push(toolCall(3));
  lines.moved({ id: "thr_pr" });
  await settled();
  assert.deepEqual(invalidated, [], "a tool call changes no line");
  assert.deepEqual(reads.at(-1), { threadId: "thr_pr", afterSeq: "2", beforeSeq: undefined });

  held.thr_pr.events.push(reply(4, "Second. More."), ...userMessage(5));
  lines.moved({ id: "thr_pr" });
  await settled();
  assert.deepEqual(invalidated, [MANAGER_LINES_TAG]);
  assert.deepEqual(reads.at(-1), { threadId: "thr_pr", afterSeq: "3", beforeSeq: undefined });
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [{ threadId: "thr_pr", line: "Second." }] });
});

test("a manager started while another is shown is read as the client asks for it, and its first reply then refreshes every client", async () => {
  const held: Record<string, Held> = { thr_one: { events: [reply(1, "One.")] } };
  const { lines, invalidated, settled } = harness(held);
  await lines.read({ threadIds: ["thr_one"] });

  held.thr_two = { events: [...userMessage(1)] };
  assert.deepEqual(await lines.read({ threadIds: ["thr_one", "thr_two"] }), { lines: [{ threadId: "thr_one", line: "One." }] });
  held.thr_two.events.push(reply(3, "Two is up."));
  lines.moved({ id: "thr_two" });
  await settled();
  assert.deepEqual(invalidated, [MANAGER_LINES_TAG]);
  assert.deepEqual((await lines.read({ threadIds: ["thr_one", "thr_two"] })).lines.at(-1), { threadId: "thr_two", line: "Two is up." });
});

test("a rewritten history is read afresh: a reply it removed leaves the line, and every client refreshes", async () => {
  const held = { thr_pr: { events: [reply(1, "Kept reply."), reply(2, "Removed reply.")] } };
  const { lines, invalidated, settled } = harness(held);
  await lines.read({ threadIds: ["thr_pr"] });

  held.thr_pr.events = [reply(1, "Kept reply.")];
  lines.changed({ id: "thr_pr", changes: ["history-rewritten"] });
  await settled();
  assert.deepEqual(invalidated, [MANAGER_LINES_TAG]);
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [{ threadId: "thr_pr", line: "Kept reply." }] });
});

test("a failed read keeps the last line, and the next client read tries again", async () => {
  const held = { thr_pr: { events: [reply(1, "Old reply.")] } };
  const { lines, settled, failNext } = harness(held);
  await lines.read({ threadIds: ["thr_pr"] });

  held.thr_pr.events.push(reply(2, "New reply."));
  failNext();
  lines.moved({ id: "thr_pr" });
  await settled();
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [{ threadId: "thr_pr", line: "New reply." }] });
});

test("a first read that fails shows no line, and the next client read tries again", async () => {
  const { lines, failNext } = harness({ thr_pr: { events: [reply(1, "Hello.")] } });
  failNext();
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [] });
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [{ threadId: "thr_pr", line: "Hello." }] });
});

test("a thread no client has read, or a change that rewrites nothing, reads nothing", async () => {
  const { lines, reads, settled } = harness({ thr_pr: { events: [reply(1, "First.")] }, thr_other: { events: [reply(1, "Other.")] } });
  await lines.read({ threadIds: ["thr_pr"] });
  const before = reads.length;
  lines.moved({ id: "thr_other" });
  lines.changed({ id: "thr_pr", changes: ["title-changed"] });
  lines.changed({ id: "thr_other", changes: ["history-rewritten"] });
  await settled();
  assert.equal(reads.length, before);
});

test("a read that fails on a manager's newest reply reads again by itself, and the new line reaches every client with no client read", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const held = { thr_pr: { events: [reply(1, "Old reply.")] } };
  const { lines, invalidated, reads, settled, failNext } = harness(held);
  await lines.read({ threadIds: ["thr_pr"] });

  held.thr_pr.events.push(reply(2, "New reply."));
  failNext();
  lines.moved({ id: "thr_pr" });
  await settled();
  assert.deepEqual(invalidated, [], "the failed read changed nothing");

  mock.timers.tick(RETRIES[0]);
  await settled();
  assert.deepEqual(invalidated, [MANAGER_LINES_TAG]);
  const before = reads.length;
  assert.deepEqual(await lines.read({ threadIds: ["thr_pr"] }), { lines: [{ threadId: "thr_pr", line: "New reply." }] });
  assert.equal(reads.length, before, "the line was already read: the client's read reads nothing");
});

test("a manager whose reads keep failing is read again three times, then waits for its thread's next move", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const held = { thr_pr: { events: [reply(1, "Old reply.")] } };
  const { lines, reads, settled, failNext } = harness(held);
  await lines.read({ threadIds: ["thr_pr"] });
  failNext(10);
  lines.moved({ id: "thr_pr" });
  await settled();
  const afterMove = reads.length;
  for (const wait of [...RETRIES, 60_000]) {
    mock.timers.tick(wait);
    await settled();
  }
  assert.equal(reads.length - afterMove, RETRIES.length);
});

test("unloading cancels a read again that is set", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const held = { thr_pr: { events: [reply(1, "Old reply.")] } };
  const { lines, reads, settled, failNext } = harness(held);
  await lines.read({ threadIds: ["thr_pr"] });
  failNext();
  lines.moved({ id: "thr_pr" });
  await settled();
  const before = reads.length;
  lines.dispose();
  mock.timers.tick(RETRIES[0]);
  await settled();
  assert.equal(reads.length, before);
});
