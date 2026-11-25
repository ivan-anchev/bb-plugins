// The read other plugins rely on: `coordinators`, published to them. The Activity Sidebar parses each
// started manager's threadId, description and avatar with its own copy of their schema (a plugin
// imports nothing from another), so renaming or reshaping one here would break it without a type
// error anywhere. These tests are where that shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import plugin from "../server.ts";
import { harness, newThreadRequest, profileNamed } from "./server/test-harness.ts";
import type { Profile } from "./model/profile/profile.ts";

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

test("another plugin reads each started manager's threadId, description and avatar, an explicit null for no description", async () => {
  const loaded = harness().load(plugin);
  const start = async (profile: Profile, goal: string) => {
    const { coordinatorId } = z.object({ coordinatorId: z.string() }).parse(await loaded.callRpc("createCoordinator", { profile }));
    return z.object({ threadId: z.string() }).parse(await loaded.callRpc("startCoordinator", { coordinatorId, request: newThreadRequest(goal) })).threadId;
  };
  const avatar = { kind: "blob", shape: "bear", hue: "purple", expression: "attentive" } as const;
  const described = await start({ ...profileNamed("PR Reviews"), description: "Reviews every open pull request.", avatar }, "Review the open pull requests");
  const bare = await start(profileNamed("Sidebar"), "Look after the sidebar");

  // why: the Activity Sidebar's own schema for this read, as it parses it (its src/model/manager-look.ts).
  const sidebarRead = z.object({
    coordinators: z.array(
      z.object({
        threadId: z.string().min(1),
        description: z.string().trim().min(1).max(500).nullable(),
        avatar: z.object({ kind: z.literal("blob"), shape: z.string(), hue: z.string(), expression: z.string() }),
      }),
    ),
  });
  const read = sidebarRead.parse(await loaded.callRpc("coordinators", {}, { experimental_caller: SIDEBAR }));
  const byThread = new Map(read.coordinators.map((look) => [look.threadId, look]));
  assert.equal(read.coordinators.length, 2);
  assert.deepEqual(byThread.get(described), { threadId: described, description: "Reviews every open pull request.", avatar });
  assert.deepEqual(byThread.get(bare), { threadId: bare, description: null, avatar: profileNamed("Sidebar").avatar });
});
