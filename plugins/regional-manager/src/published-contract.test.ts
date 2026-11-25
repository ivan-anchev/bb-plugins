// The read other plugins rely on: `coordinators`, published to them. The Activity Sidebar parses each
// started manager's threadId, description and avatar with its own copy of their schema (a plugin
// imports nothing from another), so renaming or reshaping one here would break it without a type
// error anywhere. These tests are where that shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import plugin from "../server.ts";
import { harness, newThreadRequest, profileNamed } from "./server/test-harness.ts";

const SIDEBAR = { kind: "plugin", pluginId: "activity-sidebar" } as const;

test("coordinators is the one method published to other plugins, and says what it returns", () => {
  const published = harness().load(plugin).registrations.experimental_publishedRpcMethods;
  assert.deepEqual(
    published.map(({ method }) => method),
    ["coordinators"],
  );
  assert.match(published[0].registrationDescription ?? "", /regional manager/);
});

test("its published output names each started manager's threadId, description and avatar", () => {
  const [coordinators] = harness().load(plugin).registrations.experimental_publishedRpcMethods;
  const started = z
    .object({ properties: z.object({ coordinators: z.object({ items: z.object({ properties: z.record(z.string(), z.unknown()), required: z.array(z.string()) }) }) }) })
    .parse(coordinators.outputSchema).properties.coordinators.items;
  for (const field of ["threadId", "description", "avatar"]) {
    assert.ok(field in started.properties, `${field} is published`);
    assert.ok(started.required.includes(field), `${field} is always there`);
  }
});

test("another plugin reads a started manager's threadId, description and avatar", async () => {
  const loaded = harness().load(plugin);
  const avatar = { kind: "blob", shape: "bear", hue: "violet", expression: "attentive" } as const;
  const { coordinatorId } = z.object({ coordinatorId: z.string() }).parse(await loaded.callRpc("createCoordinator", { profile: { ...profileNamed("PR Reviews"), description: "Reviews every open pull request.", avatar } }));
  const { threadId } = z.object({ threadId: z.string() }).parse(await loaded.callRpc("startCoordinator", { coordinatorId, request: newThreadRequest("Review the open pull requests") }));

  // why: the Activity Sidebar's own schema for this read, as it parses it (its src/model/manager-look.ts).
  const sidebarRead = z.object({
    coordinators: z.array(
      z.object({
        threadId: z.string().min(1),
        description: z.string().nullable(),
        avatar: z.object({ kind: z.literal("blob"), shape: z.string(), hue: z.string(), expression: z.string() }),
      }),
    ),
  });
  const read = sidebarRead.parse(await loaded.callRpc("coordinators", {}, { experimental_caller: SIDEBAR }));
  assert.deepEqual(read.coordinators, [{ threadId, description: "Reviews every open pull request.", avatar }]);
});
