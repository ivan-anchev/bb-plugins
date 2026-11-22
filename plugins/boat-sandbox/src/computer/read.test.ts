import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { BoatApiError } from "../boat/client.ts";
import { toSandbox, type Sandbox } from "../boat/sandbox.ts";
import { accountId, sandboxId, type VncDesktop } from "../boat/wire.ts";
import { problem } from "../problem.ts";
import { computerRpcHandlers } from "./read.ts";

const CAPTURED = JSON.parse(readFileSync(new URL("../boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;
const SANDBOX = sandboxId.parse("bx_a8k84ben");
const RESOURCE: JsonValue = { sandboxId: SANDBOX, key: "thr_1", accountId: accountId.parse("sandbox_1") };
const NOVNC = "https://box-node-1-6080.on.boat.dev/vnc.html?autoconnect=true&resize=remote&reconnect=true&path=websockify&password=pw&_token=tk";

function sandboxIn(state: string): Sandbox {
  const sandbox = toSandbox({ ...CAPTURED, state });
  if (sandbox === null) throw new Error(`unreachable: ${state} is present`);
  return sandbox;
}

interface World {
  provider?: string | null;
  resource?: JsonValue | null;
  sandbox?: Sandbox | null;
  desktop?: () => Promise<VncDesktop>;
  configured?: boolean;
}

function depsFor({ provider = "boat-sandbox", resource = RESOURCE, sandbox = sandboxIn("idle"), desktop = async () => ({ status: "ready", url: NOVNC }), configured = true }: World = {}): Parameters<typeof computerRpcHandlers>[0] {
  const client = { get: async () => sandbox, vncDesktop: desktop };
  return {
    sdk: {
      environments: { get: async ({ environmentId }) => ({ hostId: `host_of_${environmentId}` }) },
      hosts: { get: async ({ hostId }) => ({ id: hostId, machineProviderId: provider }) },
    },
    machines: { getResource: async () => resource },
    access: {
      configuration: async () =>
        configured ? { status: "available", client } : { status: "setup-required", problems: [problem("No boat API key is set.", "Paste one into Settings → boat Sandbox → API key")] },
    },
  };
}

const read = async (world?: World) =>
  computerRpcHandlers(depsFor(world)).computer({ environmentId: "env_1" }, { experimental_caller: { kind: "client" }, experimental_signal: AbortSignal.timeout(1_000) });
const refusing = (code: string) => async (): Promise<VncDesktop> => {
  throw new BoatApiError(400, code, `boat says ${code}`, null, false);
};

test("a thread on any other machine has no computer", async () => {
  assert.deepEqual(await read({ provider: null }), { status: "not-boat" });
  assert.deepEqual(await read({ provider: "modal" }), { status: "not-boat" });
});

test("a running sandbox shows boat's noVNC page, view-only and scaled to the frame, with its own credentials kept", async () => {
  const view = await read();
  assert.equal(view.status, "ready");
  const url = new URL(view.status === "ready" ? view.url : "");
  assert.equal(url.origin + url.pathname, "https://box-node-1-6080.on.boat.dev/vnc.html");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    autoconnect: "true",
    resize: "scale",
    reconnect: "true",
    path: "websockify",
    password: "pw",
    _token: "tk",
    view_only: "true",
  });
});

test("while boat brings the desktop view up, the page says so", async () => {
  assert.deepEqual(await read({ desktop: async () => ({ status: "provisioning" }) }), { status: "provisioning" });
});

test("a sandbox that is starting, or not made yet, reads as starting", async () => {
  assert.deepEqual(await read({ sandbox: sandboxIn("provisioning") }), { status: "starting" });
  assert.deepEqual(await read({ resource: null }), { status: "starting" });
  assert.deepEqual(await read({ desktop: refusing("desktop_not_ready") }), { status: "starting" });
});

test("a stopping or stopped sandbox reads as stopped, also when it stops between the two reads", async () => {
  assert.deepEqual(await read({ sandbox: sandboxIn("archiving") }), { status: "stopped" });
  assert.deepEqual(await read({ sandbox: sandboxIn("archived") }), { status: "stopped" });
  assert.deepEqual(await read({ desktop: refusing("machine_not_running") }), { status: "stopped" });
});

test("a stopped sandbox never asks boat for the desktop, which would be a call on a sleeping machine", async () => {
  let asked = false;
  await read({ sandbox: sandboxIn("archived"), desktop: async () => ((asked = true), { status: "provisioning" }) });
  assert.equal(asked, false);
});

test("boat's refusals and a missing setup read as unavailable, with the reason", async () => {
  assert.deepEqual(await read({ desktop: refusing("forbidden") }), { status: "unavailable", message: "boat refused the desktop view: boat says forbidden" });
  assert.deepEqual(await read({ sandbox: null }), { status: "unavailable", message: "boat no longer has the sandbox bx_a8k84ben." });
  const unconfigured = await read({ configured: false });
  assert.equal(unconfigured.status, "unavailable");
  assert.match(unconfigured.status === "unavailable" ? unconfigured.message : "", /^No boat API key is set\./);
});

test("a failed sandbox reads as unavailable with boat's note", async () => {
  const view = await read({ sandbox: toSandbox({ ...CAPTURED, state: "error", error: "disk full" }) });
  assert.deepEqual(view, { status: "unavailable", message: "The sandbox bx_a8k84ben failed (boat: disk full)." });
});

test("a network failure is not a state: it throws, so the page shows it and reads again", async () => {
  await assert.rejects(read({ desktop: () => Promise.reject(new TypeError("fetch failed")) }), /fetch failed/);
});
