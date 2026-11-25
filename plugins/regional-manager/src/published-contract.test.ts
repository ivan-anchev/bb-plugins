// The reads other plugins rely on: `coordinators` and `openIssues`, published to them. The Activity
// Sidebar parses each started manager's id, threadId, description and avatar, and each one's open
// work, with its own copy of their schemas (a plugin imports nothing from another), so renaming or
// reshaping one here would break it without a type error anywhere. These tests are where that shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import plugin from "../server.ts";
import { harness, newThreadRequest, profileNamed } from "./server/test-harness.ts";
import type { Profile } from "./model/profile/profile.ts";

const SIDEBAR = { kind: "plugin", pluginId: "activity-sidebar" } as const;

/** A published method's JSON schema for objects, as far as these tests read it: its fields, and which are required. */
const objectSchema = z.object({ properties: z.record(z.string(), z.unknown()), required: z.array(z.string()) });

/** Each named field is in `schema` and always there. */
function assertRequired(schema: z.infer<typeof objectSchema>, fields: readonly string[], of: string) {
  for (const field of fields) {
    assert.ok(field in schema.properties, `${of}.${field} is published`);
    assert.ok(schema.required.includes(field), `${of}.${field} is always there`);
  }
}

const publishedMethod = (method: string) => harness().load(plugin).registrations.experimental_publishedRpcMethods.find((published) => published.method === method) ?? assert.fail(`${method} isn't published`);

test("coordinators and openIssues are the methods published to other plugins, each saying what it returns", () => {
  const published = harness().load(plugin).registrations.experimental_publishedRpcMethods;
  assert.deepEqual(
    published.map(({ method }) => method),
    ["coordinators", "openIssues"],
  );
  assert.match(publishedMethod("coordinators").methodDescription ?? "", /regional manager/);
  assert.match(publishedMethod("openIssues").methodDescription ?? "", /open work/);
});

test("its published output names each started manager's id, threadId, description and avatar", () => {
  const started = z
    .object({ properties: z.object({ coordinators: z.object({ items: objectSchema }) }) })
    .parse(publishedMethod("coordinators").outputSchema).properties.coordinators.items;
  assertRequired(started, ["id", "threadId", "description", "avatar"], "coordinators");
});

test("openIssues is keyed by managers' ids, and names each one's issues with their parentId, their reasons, the parents and the decisions", () => {
  const { inputSchema, outputSchema } = publishedMethod("openIssues");
  assertRequired(objectSchema.parse(inputSchema), ["keys"], "input");
  const work = z.object({ additionalProperties: objectSchema.extend({ properties: z.record(z.string(), z.object({ items: objectSchema })) }) }).parse(outputSchema).additionalProperties;
  assertRequired(work, ["needsYou", "underWay", "parents", "decisions"], "openIssues");
  const list = (name: string) => work.properties[name] ?? assert.fail(`no ${name}`);
  assertRequired(list("needsYou").items, ["id", "title", "status", "reason", "parentId"], "needsYou");
  assertRequired(list("underWay").items, ["id", "title", "status", "parentId"], "underWay");
  assertRequired(list("parents").items, ["id", "title", "status"], "parents");
  assertRequired(list("decisions").items, ["id", "question"], "decisions");
});

test("another plugin reads each started manager's id, threadId, description and avatar, an explicit null for no description", async () => {
  const loaded = harness().load(plugin);
  const start = async (profile: Profile, goal: string) => {
    const { coordinatorId } = z.object({ coordinatorId: z.string() }).parse(await loaded.callRpc("createCoordinator", { profile }));
    const { threadId } = z.object({ threadId: z.string() }).parse(await loaded.callRpc("startCoordinator", { coordinatorId, request: newThreadRequest(goal) }));
    return { id: coordinatorId, threadId };
  };
  const avatar = { kind: "blob", shape: "bear", hue: "violet", expression: "attentive" } as const;
  const described = await start({ ...profileNamed("PR Reviews"), description: "Reviews every open pull request.", avatar }, "Review the open pull requests");
  const bare = await start(profileNamed("Sidebar"), "Look after the sidebar");

  // why: the Activity Sidebar's own schema for this read, as it parses it (its src/model/manager-look.ts).
  const sidebarRead = z.object({
    coordinators: z.array(
      z.object({
        id: z.string().min(1),
        threadId: z.string().min(1),
        description: z.string().trim().min(1).max(500).nullable(),
        avatar: z.object({ kind: z.literal("blob"), shape: z.string(), hue: z.string(), expression: z.string() }),
      }),
    ),
  });
  const read = sidebarRead.parse(await loaded.callRpc("coordinators", {}, { experimental_caller: SIDEBAR }));
  const byThread = new Map(read.coordinators.map((look) => [look.threadId, look]));
  assert.equal(read.coordinators.length, 2);
  assert.deepEqual(byThread.get(described.threadId), { ...described, description: "Reviews every open pull request.", avatar });
  assert.deepEqual(byThread.get(bare.threadId), { ...bare, description: null, avatar: profileNamed("Sidebar").avatar });
});
