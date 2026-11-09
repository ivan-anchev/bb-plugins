import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { PendingInteraction } from "./bb-types.ts";
import { deliverWith } from "./delivery.ts";
import { parseRoutes, type Routes } from "./routes.ts";
import type { EndpointLookup } from "./target-secrets.ts";
import { memoryFailureLog, question, startReceiver, thread, until } from "./test-support.ts";
import { createWaker } from "./waker.ts";

const KEY = "dummy-key-waker";
const receiver = await startReceiver();
after(() => receiver.close());
beforeEach(() => {
  receiver.requests.length = 0;
  receiver.state.status = 200;
});

/** A waker routing proj_1 to OPS, whose endpoint is the local receiver unless overridden. */
function setup(
  options: {
    pending?: PendingInteraction | null;
    lookup?: EndpointLookup;
    interrupted?: () => Promise<boolean>;
    signal?: AbortSignal;
    routes?: () => Promise<Routes>;
  } = {},
) {
  const parsed = parseRoutes('{"projects": {"proj_1": "ops"}}');
  assert.ok(parsed.ok);
  const lookup = options.lookup ?? { ok: true, endpoint: { url: receiver.url, key: KEY } };
  const log = memoryFailureLog();
  const messages: string[] = [];
  const record = (message: string) => void messages.push(message);
  const waker = createWaker({
    routes: options.routes ?? (async () => parsed.routes),
    pendingInteraction: async () => options.pending ?? null,
    lastTurnInterrupted: options.interrupted ?? (async () => false),
    deliver: deliverWith({ endpoint: async () => lookup }),
    failures: log.failures,
    log: { debug: record, info: record, warn: record, error: record },
    signal: options.signal ?? new AbortController().signal,
  });
  return { waker, ...log, messages };
}

function sentBodies() {
  return receiver.requests.map((request) => JSON.parse(request.body));
}

test("a finished turn sends one POST with the thread's body", async () => {
  const { waker } = setup();
  await waker.onThreadIdle({ thread: thread(), lastAssistantText: "Build fixed. Tests pass. Lint too." });
  await waker.idle();
  assert.deepEqual(sentBodies(), [
    {
      project: "proj_1",
      section: null,
      thread: "thr_abcdefgh123",
      event: "finished",
      title: "Fix the build",
      summary: "Build fixed. Tests pass.",
    },
  ]);
});

test("a handler returns while a slow receiver has not answered; unloading then logs the POST as cancelled", async () => {
  const unload = new AbortController();
  const { waker, failures } = setup({ signal: unload.signal });
  receiver.state.hang = true;
  try {
    await waker.onThreadIdle({ thread: thread(), lastAssistantText: "Done." });
    // The handler is back, and the POST is out but unanswered: nothing has failed yet.
    await until(() => receiver.requests.length === 1);
    assert.deepEqual(failures.list(), []);

    unload.abort();
    await waker.idle();
    assert.deepEqual(failures.list().map((entry) => entry.reason), ["cancelled"]);
  } finally {
    receiver.state.hang = false;
  }
});

test("unloading while a handler is still looking up its route still logs its POST as cancelled before idle returns", async () => {
  const unload = new AbortController();
  const parsed = parseRoutes('{"projects": {"proj_1": "ops"}}');
  assert.ok(parsed.ok);
  let releaseRoutes = () => {};
  const routesHeld = new Promise<void>((resolve) => (releaseRoutes = resolve));
  const { waker, failures } = setup({
    signal: unload.signal,
    routes: async () => {
      await routesHeld;
      return parsed.routes;
    },
  });
  const handled = waker.onThreadIdle({ thread: thread(), lastAssistantText: "Done." });
  unload.abort();
  releaseRoutes();
  await waker.idle();
  await handled;
  assert.deepEqual(failures.list().map((entry) => entry.reason), ["cancelled"]);
  assert.equal(receiver.requests.length, 0);
});

test("an error thrown while sending is logged, and the handler still returns", async () => {
  const log = memoryFailureLog();
  const parsed = parseRoutes('{"projects": {"proj_1": "ops"}}');
  assert.ok(parsed.ok);
  const messages: string[] = [];
  const record = (message: string) => void messages.push(message);
  const waker = createWaker({
    routes: async () => parsed.routes,
    pendingInteraction: async () => null,
    lastTurnInterrupted: async () => false,
    deliver: async () => {
      throw new Error("settings unavailable");
    },
    failures: log.failures,
    log: { debug: record, info: record, warn: record, error: record },
    signal: new AbortController().signal,
  });
  await waker.onThreadFailed({ thread: thread(), error: "boom" });
  await waker.idle();
  assert.ok(messages.some((message) => message.includes("could not send failed on thr_abcdefgh123: Error: settings unavailable")));
});

test("a thread idling after a user stop sends nothing and logs no failure", async () => {
  receiver.state.status = 500;
  const { waker, failures } = setup({ interrupted: async () => true });
  await waker.onThreadIdle({ thread: thread(), lastAssistantText: "Stopped mid-command." });
  await waker.idle();
  assert.equal(receiver.requests.length, 0);
  assert.deepEqual(failures.list(), []);
});

test("a thread idling after a completed turn sends one finished", async () => {
  const { waker } = setup({ interrupted: async () => false });
  await waker.onThreadIdle({ thread: thread(), lastAssistantText: "Done." });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ event, summary }) => ({ event, summary })), [{ event: "finished", summary: "Done." }]);
});

test("a completed turn after a stopped one sends one finished; a late repeat of the stop sends nothing", async () => {
  let interrupted = true;
  const { waker } = setup({ interrupted: async () => interrupted });
  const stopped = { thread: thread({ updatedAt: 100 }), lastAssistantText: "Stopped." };
  await waker.onThreadIdle(stopped);
  interrupted = false;
  await waker.onThreadIdle(stopped);
  await waker.onThreadIdle({ thread: thread({ updatedAt: 250 }), lastAssistantText: "Done." });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ event, summary }) => ({ event, summary })), [{ event: "finished", summary: "Done." }]);
});

test("when how the turn ended cannot be read, the idle thread still sends finished", async () => {
  const { waker, messages } = setup({ interrupted: async () => Promise.reject(new Error("events unavailable")) });
  await waker.onThreadIdle({ thread: thread(), lastAssistantText: "Done." });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ event }) => event), ["finished"]);
  assert.ok(messages.some((message) => message.includes("events unavailable")));
});

test("a stopped last turn does not hold back an interaction or a failure", async () => {
  const { waker } = setup({ interrupted: async () => true });
  await waker.onInteractionPending({ thread: thread(), interaction: question("int_1", "Which database?") });
  await waker.onThreadFailed({ thread: thread({ updatedAt: 250 }), error: "boom" });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ event }) => event), ["interaction", "failed"]);
});

test("an open question sends its prompt; a failure sends its error", async () => {
  const { waker } = setup();
  await waker.onInteractionPending({ thread: thread(), interaction: question("int_1", "Which database?") });
  await waker.onThreadFailed({ thread: thread({ id: "thr_2" }), error: "Provider rejected request" });
  await waker.idle();
  assert.deepEqual(
    sentBodies().map(({ event, summary }) => ({ event, summary })),
    [
      { event: "interaction", summary: "Which database?" },
      { event: "failed", summary: "Provider rejected request" },
    ],
  );
});

test("hidden threads and child threads send nothing", async () => {
  const { waker } = setup();
  await waker.onThreadIdle({ thread: thread({ visibility: "hidden" }), lastAssistantText: "done" });
  await waker.onThreadFailed({ thread: thread({ parentThreadId: "thr_parent" }), error: "boom" });
  await waker.idle();
  assert.equal(receiver.requests.length, 0);
});

test("an unrouted thread sends nothing and logs no failure", async () => {
  const { waker, failures } = setup({ lookup: { ok: false, missing: ["BOT_WAKE_OPS_URL"] } });
  await waker.onThreadIdle({ thread: thread({ projectId: "proj_other" }), lastAssistantText: "done" });
  await waker.idle();
  assert.equal(receiver.requests.length, 0);
  assert.deepEqual(failures.list(), []);
});

test("the same signal delivered twice sends one POST", async () => {
  const { waker } = setup();
  const idle = { thread: thread(), lastAssistantText: "done" };
  await waker.onThreadIdle(idle);
  await waker.onThreadIdle(idle);
  const pending = { thread: thread(), interaction: question("int_1", "Which database?") };
  await waker.onInteractionPending(pending);
  await waker.onInteractionPending(pending);
  const failed = { thread: thread({ updatedAt: 300 }), error: "boom" };
  await Promise.all([waker.onThreadFailed(failed), waker.onThreadFailed(failed)]);
  await waker.idle();
  assert.deepEqual(sentBodies().map((body) => body.event), ["finished", "interaction", "failed"]);
});

test("a thread that goes idle on an open question sends the question once, not also finished", async () => {
  const open = question("int_1", "Ship it?");
  const { waker } = setup({ pending: open });
  await waker.onInteractionPending({ thread: thread({ status: "active" }), interaction: open });
  await waker.onThreadIdle({ thread: thread({ updatedAt: 200 }), lastAssistantText: "Waiting on you." });
  await waker.idle();
  assert.deepEqual(sentBodies().map((body) => body.event), ["interaction"]);
});

test("idle arriving before the question's own signal still sends one interaction", async () => {
  const open = question("int_1", "Ship it?");
  const { waker } = setup({ pending: open });
  await waker.onThreadIdle({ thread: thread({ updatedAt: 200 }), lastAssistantText: "Waiting on you." });
  await waker.onInteractionPending({ thread: thread({ updatedAt: 200 }), interaction: open });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ event, summary }) => ({ event, summary })), [
    { event: "interaction", summary: "Ship it?" },
  ]);
});

test("a later genuine transition sends again", async () => {
  const { waker } = setup();
  await waker.onThreadIdle({ thread: thread({ updatedAt: 100 }), lastAssistantText: "First turn." });
  await waker.onThreadIdle({ thread: thread({ updatedAt: 250 }), lastAssistantText: "Second turn." });
  await waker.onInteractionPending({ thread: thread(), interaction: question("int_1", "One?") });
  await waker.onInteractionPending({ thread: thread(), interaction: question("int_2", "Two?") });
  await waker.idle();
  assert.deepEqual(sentBodies().map((body) => body.summary), ["First turn.", "Second turn.", "One?", "Two?"]);
});

test("a delayed repeat of an earlier finished or failed state sends nothing", async () => {
  const { waker } = setup();
  await waker.onThreadIdle({ thread: thread({ updatedAt: 100 }), lastAssistantText: "First turn." });
  await waker.onThreadFailed({ thread: thread({ updatedAt: 250 }), error: "Second turn broke." });
  await waker.onThreadIdle({ thread: thread({ updatedAt: 100 }), lastAssistantText: "First turn." });
  await waker.idle();
  assert.deepEqual(sentBodies().map((body) => body.summary), ["First turn.", "Second turn broke."]);
});

test("a delayed repeat of an earlier interaction sends nothing", async () => {
  const { waker } = setup();
  await waker.onInteractionPending({ thread: thread(), interaction: question("int_1", "One?") });
  await waker.onInteractionPending({ thread: thread(), interaction: question("int_2", "Two?") });
  await waker.onInteractionPending({ thread: thread(), interaction: question("int_1", "One?") });
  await waker.idle();
  assert.deepEqual(sentBodies().map((body) => body.summary), ["One?", "Two?"]);
});

test("overlapping handlers for A, B, then A again send A and B once each", async () => {
  const { waker } = setup();
  const a = { thread: thread({ updatedAt: 100 }), lastAssistantText: "A." };
  const b = { thread: thread({ updatedAt: 250 }), lastAssistantText: "B." };
  await Promise.all([waker.onThreadIdle(a), waker.onThreadIdle(b), waker.onThreadIdle(a)]);
  await waker.idle();
  assert.deepEqual(sentBodies().map((body) => body.summary).sort(), ["A.", "B."]);
});

test("a repeat of a state whose delivery failed logs no second failure", async () => {
  receiver.state.status = 500;
  const { waker, failures } = setup();
  await waker.onThreadFailed({ thread: thread({ updatedAt: 100 }), error: "A" });
  await waker.onThreadFailed({ thread: thread({ updatedAt: 250 }), error: "B" });
  await waker.onThreadFailed({ thread: thread({ updatedAt: 100 }), error: "A" });
  await waker.idle();
  assert.deepEqual(failures.list().map((entry) => entry.body.summary), ["A", "B"]);
});

test("an approval of a kind newer than this SDK still sends, with a neutral summary", async () => {
  const { waker } = setup();
  // Deliberately off-type: a newer bb can send an approval subject kind this SDK does not know.
  const newer = {
    ...question("int_9", "unused"),
    payload: { kind: "approval", subject: { kind: "browser_action", url: "https://example.test" } },
  } as unknown as PendingInteraction;
  await waker.onInteractionPending({ thread: thread(), interaction: newer });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ event, summary }) => ({ event, summary })), [
    { event: "interaction", summary: "The agent is waiting for an approval." },
  ]);
});

test("an extension interaction is summarized by its title", async () => {
  const { waker } = setup();
  const review: PendingInteraction = {
    createdAt: 1,
    id: "int_8",
    payload: { kind: "acme/review", data: null, title: "Review the deploy plan." },
    providerId: "claude-code",
    providerRequestId: "req",
    providerThreadId: "pt",
    resolution: null,
    resolvedAt: null,
    status: "pending",
    statusReason: null,
    threadId: "thr_abcdefgh123",
    turnId: "turn_1",
  };
  await waker.onInteractionPending({ thread: thread(), interaction: review });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ summary }) => summary), ["Review the deploy plan."]);
});

test("an interaction of a kind newer than this SDK still sends, with a neutral summary", async () => {
  const { waker } = setup();
  // Deliberately off-type: a newer bb can send an interaction payload kind this SDK does not know, with no title.
  const newer = {
    ...question("int_9", "unused"),
    payload: { kind: "browser_handoff", url: "https://example.test" },
  } as unknown as PendingInteraction;
  await waker.onInteractionPending({ thread: thread(), interaction: newer });
  await waker.idle();
  assert.deepEqual(sentBodies().map(({ event, summary }) => ({ event, summary })), [
    { event: "interaction", summary: "The agent is waiting for input." },
  ]);
});

test("each kind of failed delivery writes one entry with no URL or key in it", async () => {
  const cases = [
    { name: "non-2xx", reason: "http 503", arrange: () => (receiver.state.status = 503) },
    { name: "missing secret", reason: "missing-secret", lookup: { ok: false, missing: ["BOT_WAKE_OPS_KEY"] } },
    { name: "network", reason: "network", lookup: { ok: true, endpoint: { url: "http://127.0.0.1:1/hook", key: KEY } } },
  ] as const;
  for (const { name, reason, ...rest } of cases) {
    receiver.state.status = 200;
    if ("arrange" in rest) rest.arrange();
    const { waker, failures, rawRows, messages } = setup("lookup" in rest ? { lookup: rest.lookup } : {});
    await waker.onThreadIdle({ thread: thread(), lastAssistantText: "done" });
    await waker.idle();

    const entries = failures.list();
    assert.equal(entries.length, 1, name);
    assert.equal(entries[0].reason, reason, name);
    assert.equal(entries[0].target, "OPS", name);
    assert.equal(entries[0].body.event, "finished", name);
    const everything = rawRows() + messages.join("\n");
    for (const secret of [KEY, receiver.url, "127.0.0.1"]) assert.ok(!everything.includes(secret), `${name}: ${secret}`);
  }
});

test("a timeout is logged like any other failure", async () => {
  const log = memoryFailureLog();
  const parsed = parseRoutes('{"projects": {"proj_1": "ops"}}');
  assert.ok(parsed.ok);
  const waker = createWaker({
    routes: async () => parsed.routes,
    pendingInteraction: async () => null,
    lastTurnInterrupted: async () => false,
    deliver: async () => ({ ok: false, reason: "timeout" }),
    failures: log.failures,
    log: { debug() {}, info() {}, warn() {}, error() {} },
    signal: new AbortController().signal,
  });
  await waker.onThreadFailed({ thread: thread(), error: "boom" });
  await waker.idle();
  assert.deepEqual(log.failures.list().map((entry) => entry.reason), ["timeout"]);
});

test("a delivered event writes no failure", async () => {
  const { waker, failures } = setup();
  await waker.onThreadIdle({ thread: thread(), lastAssistantText: "done" });
  await waker.idle();
  assert.equal(receiver.requests.length, 1);
  assert.deepEqual(failures.list(), []);
});
