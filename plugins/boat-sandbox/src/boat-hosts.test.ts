import assert from "node:assert/strict";
import { test } from "node:test";
import { markBoatHosts } from "./boat-hosts.ts";

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
