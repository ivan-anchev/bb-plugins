import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deliverWith, post } from "./delivery.ts";
import { parseTarget } from "./routes.ts";
import { startReceiver } from "./test-support.ts";
import { TEST_BODY } from "./wake-body.ts";

const receiver = await startReceiver();
after(() => receiver.close());

const endpoint = { url: receiver.url, key: "dummy-key-delivery" };
const open = new AbortController().signal;

test("a POST carries JSON, both auth headers, and exactly the six body fields", async () => {
  receiver.state.status = 204;
  const result = await post(endpoint, TEST_BODY, open);

  assert.deepEqual(result, { ok: true, status: 204 });
  const request = receiver.requests.at(-1);
  assert.ok(request);
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/hook");
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers.authorization, "Bearer dummy-key-delivery");
  assert.equal(request.headers["x-automation-key"], "dummy-key-delivery");
  assert.deepEqual(Object.keys(JSON.parse(request.body)), ["project", "section", "thread", "event", "title", "summary"]);
});

test("a non-2xx answer fails as its status", async () => {
  receiver.state.status = 500;
  assert.deepEqual(await post(endpoint, TEST_BODY, open), { ok: false, reason: "http 500" });
});

test("a redirect fails as its status: one request, and the key never reaches the redirect's target", async () => {
  const elsewhere = await startReceiver();
  receiver.state.status = 307;
  receiver.state.location = elsewhere.url;
  const before = receiver.requests.length;
  try {
    assert.deepEqual(await post(endpoint, TEST_BODY, open), { ok: false, reason: "http 307" });
    assert.equal(receiver.requests.length, before + 1);
    assert.deepEqual(elsewhere.requests, []);
  } finally {
    receiver.state.status = 200;
    receiver.state.location = null;
    await elsewhere.close();
  }
});

test("a request stopped by its caller fails as cancelled, not a timeout", async () => {
  receiver.state.hang = true;
  const caller = new AbortController();
  try {
    const pending = post(endpoint, TEST_BODY, caller.signal, 5000);
    setTimeout(() => caller.abort(), 20);
    const started = Date.now();
    assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
    assert.ok(Date.now() - started < 1000);
  } finally {
    receiver.state.hang = false;
  }
});

test("no answer in time fails as a timeout", async () => {
  receiver.state.hang = true;
  try {
    assert.deepEqual(await post(endpoint, TEST_BODY, open, 50), { ok: false, reason: "timeout" });
  } finally {
    receiver.state.hang = false;
  }
});

test("an unreachable host fails as a network error", async () => {
  const closed = await startReceiver();
  await closed.close();
  assert.deepEqual(await post({ ...endpoint, url: closed.url }, TEST_BODY, open), { ok: false, reason: "network" });
});

test("a target without its URL or key fails as a missing secret, with no request", async () => {
  const before = receiver.requests.length;
  const deliver = deliverWith({ endpoint: async () => ({ ok: false, missing: ["BOT_WAKE_OPS_KEY"] }) });
  const target = parseTarget("ops");
  assert.ok(target);

  assert.deepEqual(await deliver(target, TEST_BODY, open), { ok: false, reason: "missing-secret" });
  assert.equal(receiver.requests.length, before);
});

test("a secret lookup cut off by its caller fails as cancelled, not as a missing secret", async () => {
  const caller = new AbortController();
  const deliver = deliverWith({
    async endpoint() {
      caller.abort();
      return { ok: false, missing: ["BOT_WAKE_OPS_URL", "BOT_WAKE_OPS_KEY"] };
    },
  });
  const target = parseTarget("ops");
  assert.ok(target);

  assert.deepEqual(await deliver(target, TEST_BODY, caller.signal), { ok: false, reason: "cancelled" });
});
