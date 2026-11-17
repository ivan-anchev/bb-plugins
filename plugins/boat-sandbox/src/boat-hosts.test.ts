import assert from "node:assert/strict";
import { test } from "node:test";
import { boatHostOf, markBoatHosts } from "./boat-hosts.ts";

const hosts = [
  { id: "host_boat", machineProviderId: "boat-sandbox" },
  { id: "host_laptop", machineProviderId: null },
  { id: "host_modal", machineProviderId: "modal" },
];

test("only a boat machine is marked; other hosts and hosts bb does not list read false", () => {
  assert.deepEqual(markBoatHosts(["host_boat", "host_laptop", "host_modal", "host_gone"], hosts), {
    host_boat: true,
    host_laptop: false,
    host_modal: false,
    host_gone: false,
  });
});

test("an environment is a boat one when the host it runs on is a boat machine", async () => {
  const sdk = {
    environments: { get: async ({ environmentId }: { environmentId: string }) => ({ hostId: environmentId === "env_boat" ? "host_boat" : "host_laptop" }) },
    hosts: { get: async ({ hostId }: { hostId: string }) => hosts.find((host) => host.id === hostId)! },
  };
  const signal = AbortSignal.timeout(1_000);
  assert.equal(await boatHostOf(sdk, "env_boat", signal), "host_boat");
  assert.equal(await boatHostOf(sdk, "env_worktree", signal), null);
});
