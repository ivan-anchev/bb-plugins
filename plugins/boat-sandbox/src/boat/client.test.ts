import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";
import { createBoatClient } from "./client.ts";
import { sandboxId } from "./wire.ts";

const SANDBOX = sandboxId.parse("bx_a8k84ben");

afterEach(() => mock.restoreAll());

/** A streamed command response cut into chunks that split NDJSON lines mid-frame. */
function ndjson(frames: object[], chunkSize: number): Response {
  const text = frames.map((frame) => `${JSON.stringify(frame)}\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += chunkSize) controller.enqueue(bytes.slice(at, at + chunkSize));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

// Frames as boat sent them for the spike's enrollment (spike/enroll-stream.ndjson).
const ENROLL_FRAMES = [
  { type: "started", commandId: "cmd_d82phy5whurp" },
  { type: "stdout", data: "  ✓  Using local host-daemon port 38888\n" },
  { type: "stderr", data: "added 46 packages in 5s\n" },
  { type: "exit", success: false, exitCode: 3, signal: null, timedOut: false },
];

async function run(client = createBoatClient("boat_test")) {
  let output = "";
  const { exitCode } = await client.run(SANDBOX, {
    command: "true",
    timeoutSeconds: 10,
    signal: AbortSignal.timeout(10_000),
    onOutput: (chunk) => (output += chunk),
  });
  return { exitCode, output };
}

test("a streamed command forwards its output and returns the exit frame's code", async () => {
  mock.method(globalThis, "fetch", async () => ndjson(ENROLL_FRAMES, 7));

  assert.deepEqual(await run(), {
    exitCode: 3,
    output: "  ✓  Using local host-daemon port 38888\nadded 46 packages in 5s\n",
  });
});

test("a command sent while the sandbox starts is sent again", async () => {
  const starting = { code: "sandbox_starting", message: "The sandbox is still starting." };
  const fetch = mock.method(globalThis, "fetch", async () =>
    fetch.mock.callCount() === 0 ? new Response(JSON.stringify(starting), { status: 409 }) : ndjson(ENROLL_FRAMES, 64));

  assert.equal((await run()).exitCode, 3);
  assert.equal(fetch.mock.callCount(), 2);
});

test("list follows boat's cursor until the last page", async () => {
  const captured = JSON.parse(readFileSync(new URL("./fixtures/create-a.json", import.meta.url), "utf8")).sandbox;
  const pages = [
    { sandboxes: [{ ...captured, id: "bx_aaaaaaaa" }], pageInfo: { nextCursor: "page-2", hasMore: true, limit: 200 } },
    { sandboxes: [{ ...captured, id: "bx_bbbbbbbb" }], pageInfo: { nextCursor: null, hasMore: false, limit: 200 } },
  ];
  const fetch = mock.method(globalThis, "fetch", async () => Response.json(pages[fetch.mock.callCount()]));

  const listed = await createBoatClient("boat_test").list({ "bb.boat/owner": "owner-1" }, AbortSignal.timeout(10_000));

  assert.deepEqual(listed.map(({ id }) => id), ["bx_aaaaaaaa", "bx_bbbbbbbb"]);
  const urls = fetch.mock.calls.map(({ arguments: [url] }) => new URL(String(url)));
  assert.deepEqual(urls.map(({ searchParams }) => searchParams.get("cursor")), [null, "page-2"]);
  assert.equal(urls[0]?.searchParams.get("label"), "bb.boat/owner=owner-1");
});
