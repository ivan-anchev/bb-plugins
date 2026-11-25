import assert from "node:assert/strict";
import { test } from "node:test";
import { MANAGER_LINES_TAG } from "../../contract.ts";
import { openManagerLines } from "./manager-lines.ts";

// bb's events as a list per thread, answering `events.list` as bb does: only the types asked for,
// newest first before `beforeSeq` or oldest first after `afterSeq`, at most `limit`. The open managers
// are the threads it holds.

type Row = { seq: number; type: string; data: unknown };

const reply = (seq: number, text: string, extra: Record<string, unknown> = {}): Row => ({ seq, type: "item/completed", data: { item: { type: "agentMessage", id: `i${seq}`, text, ...extra } } });
const toolCall = (seq: number): Row => ({ seq, type: "item/completed", data: { item: { type: "toolCall", id: `i${seq}`, server: "bb", tool: "issue_create", arguments: {}, result: "Created. Done." } } });
const commandRun = (seq: number): Row => ({ seq, type: "item/completed", data: { item: { type: "commandExecution", id: `i${seq}`, command: "ls", aggregatedOutput: "Output. More." } } });
/** What a user's (or the Regional Manager plugin's wake) message is in bb's events: a turn requested, never a completed item. */
const userMessage = (seq: number): Row => ({ seq, type: "client/turn/requested", data: { input: [{ type: "text", text: "[Regional Manager] Wake up. Check the board." }] } });

const MANAGER = { originPluginId: "regional-manager", parentThreadId: null };

function harness(events: Record<string, Row[]>) {
  const invalidated: string[] = [];
  const reads: { threadId: string; afterSeq?: string; beforeSeq?: string }[] = [];
  const lines = openManagerLines({
    threads: {
      list: async () => Object.keys(events).map((id) => ({ id })),
      events: {
        list: async ({ threadId, types, order, afterSeq, beforeSeq, limit }) => {
          reads.push({ threadId, afterSeq, beforeSeq });
          const rows = events[threadId].filter((row) => types.includes(row.type as never));
          const picked = order === "asc" ? rows.filter((row) => row.seq > Number(afterSeq ?? 0)) : rows.filter((row) => beforeSeq === undefined || row.seq < Number(beforeSeq)).reverse();
          return picked.slice(0, Number(limit));
        },
      },
    },
    rpc: { experimental_invalidate: (tags) => void invalidated.push(...tags) },
    log: { warn: () => {} },
  });
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { lines, invalidated, reads, settled };
}

test("a manager's line is the first sentence of its latest own reply with text: tool calls, results, empty replies, subagents' replies and user messages are skipped", async () => {
  const { lines } = harness({
    thr_pr: [
      reply(1, "An older reply. Not this one."),
      reply(2, "**Two** pull requests [wait](https://x.test/pulls) on you. The rest are green."),
      toolCall(3),
      commandRun(4),
      reply(5, "   "),
      reply(6, "A subagent's finding. Not the manager's.", { parentToolCallId: "i3" }),
      userMessage(7),
    ],
  });
  assert.deepEqual(await lines.read(), { lines: [{ threadId: "thr_pr", line: "Two pull requests wait on you." }] });
});

test("a manager with no such reply has no line, so its row shows its name alone", async () => {
  const { lines } = harness({ thr_new: [userMessage(1), toolCall(2), reply(3, "")], thr_empty: [] });
  assert.deepEqual(await lines.read(), { lines: [] });
});

test("a reply further back than the first page is still found", async () => {
  const tools = Array.from({ length: 120 }, (_, at) => toolCall(at + 2));
  const { lines } = harness({ thr_pr: [reply(1, "Found it."), ...tools] });
  assert.deepEqual(await lines.read(), { lines: [{ threadId: "thr_pr", line: "Found it." }] });
});

test("as a manager's thread moves, only its items since are read, and a new reply changes its line and refreshes every client", async () => {
  const events = { thr_pr: [reply(1, "First."), toolCall(2)] };
  const { lines, invalidated, reads, settled } = harness(events);
  await lines.read();

  events.thr_pr.push(toolCall(3));
  lines.moved({ id: "thr_pr", ...MANAGER });
  await settled();
  assert.deepEqual(invalidated, [], "a tool call changes no line");
  assert.deepEqual(reads.at(-1), { threadId: "thr_pr", afterSeq: "2", beforeSeq: undefined });

  events.thr_pr.push(reply(4, "Second. More."), userMessage(5));
  lines.moved({ id: "thr_pr", ...MANAGER });
  await settled();
  assert.deepEqual(invalidated, [MANAGER_LINES_TAG]);
  assert.deepEqual(reads.at(-1), { threadId: "thr_pr", afterSeq: "3", beforeSeq: undefined });
  assert.deepEqual(await lines.read(), { lines: [{ threadId: "thr_pr", line: "Second." }] });
});

test("a thread that isn't a manager's, or one no client has read, reads nothing", async () => {
  const { lines, reads, settled } = harness({ thr_pr: [reply(1, "First.")] });
  lines.moved({ id: "thr_pr", ...MANAGER });
  await lines.read();
  const before = reads.length;
  lines.moved({ id: "thr_pr", originPluginId: null, parentThreadId: null });
  lines.moved({ id: "thr_pr", originPluginId: "regional-manager", parentThreadId: "thr_parent" });
  await settled();
  assert.equal(reads.length, before);
});
