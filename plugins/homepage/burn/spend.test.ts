import assert from "node:assert/strict";
import { test } from "node:test";
import { readBurnSpend } from "./spend.ts";

function httpError(status: number, message: string, code: string | null = null): Error {
  return Object.assign(new Error(`HTTP ${status}: ${message}`), { name: "BbHttpError", status, code });
}

type CallRpc = Parameters<typeof readBurnSpend>[0];
const failing = (error: unknown): CallRpc => (async () => { throw error; }) as CallRpc;
const answering = (reply: unknown, calls: unknown[] = []): CallRpc =>
  (async (args: Parameters<CallRpc>[0]) => {
    calls.push({ pluginId: args.pluginId, method: args.method, input: args.input });
    return args.outputSchema.parse(reply);
  }) as CallRpc;

const BURN_REPLY = {
  range: "7d",
  tz: "local",
  total: 1800.2,
  previousTotal: 800,
  tokens: 5_130_000_000,
  previousTokens: 1_990_000_000,
  calls: 4210,
  threads: [{ threadId: "thr_1", title: "x" }],
};

test("asks Burn for every project's spend over the range and keeps the four numbers", async () => {
  const calls: unknown[] = [];
  const spend = await readBurnSpend(answering(BURN_REPLY, calls), "7d");
  assert.deepEqual(calls, [{ pluginId: "burn", method: "spend", input: { range: "7d", projectId: null } }]);
  assert.deepEqual(spend, { status: "ready", total: 1800.2, previousTotal: 800, tokens: 5_130_000_000, previousTokens: 1_990_000_000 });
});

test("Burn not installed", async () => {
  const spend = await readBurnSpend(failing(httpError(404, 'unknown plugin "burn"')), "7d");
  assert.deepEqual(spend, { status: "unavailable", message: "Install the Burn plugin to see spend here." });
});

test("Burn turned off, starting, or failed to load", async () => {
  const off = await readBurnSpend(failing(httpError(503, 'plugin "burn" is not running (status: disabled)')), "30d");
  assert.deepEqual(off, { status: "unavailable", message: "Burn is turned off. Turn it on in Extensions to see spend here." });
  const starting = await readBurnSpend(failing(httpError(503, 'plugin "burn" is not running (status: starting)')), "30d");
  assert.equal(starting.status === "unavailable" && starting.message, "Burn is starting…");
  const broken = await readBurnSpend(failing(httpError(503, 'plugin "burn" is not running (status: error — boom)')), "30d");
  assert.equal(broken.status === "unavailable" && broken.message, "Burn isn’t running. Check it in Extensions.");
});

test("a Burn without the spend method, or one that refuses the input, asks for an update", async () => {
  for (const error of [
    httpError(404, 'plugin "burn" has no rpc method "spend"', "unknown_method"),
    httpError(400, "range: Invalid option", "invalid_input"),
  ]) {
    const spend = await readBurnSpend(failing(error), "7d");
    assert.deepEqual(spend, { status: "unavailable", message: "This version of Burn can’t report spend here. Update Burn." });
  }
});

test("a reply missing a number the card reads says Burn changed shape", async () => {
  const { tokens: _dropped, ...withoutTokens } = BURN_REPLY;
  const spend = await readBurnSpend(answering(withoutTokens), "7d");
  assert.deepEqual(spend, { status: "unavailable", message: "Burn’s reply changed shape. Update Homepage to read it." });
  const negative = await readBurnSpend(answering({ ...BURN_REPLY, total: -1 }), "7d");
  assert.equal(negative.status, "unavailable");
});

test("any other failure says what went wrong, briefly", async () => {
  const thrown = await readBurnSpend(failing(httpError(500, "database is locked", "handler_error")), "7d");
  assert.deepEqual(thrown, { status: "unavailable", message: "Couldn’t read Burn: database is locked" });
  const long = await readBurnSpend(failing(new Error("x".repeat(400))), "7d");
  assert.ok(long.status === "unavailable" && long.message.length < 160 && long.message.endsWith("…"));
});
