import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import type { Coordinator, NotStarted } from "../../contract.ts";
import { DEFAULT_AVATAR } from "../../model/profile.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { listView } from "./coordinator-groups.ts";

const project = (id: string) => ({ id, name: `Project ${id}` });
const thread = (n: number, projectId: string) => ({ id: `thr_${n}`, projectId });

const coordinator = (n: number, projectId: string): Coordinator => ({
  id: coordinatorIdSchema.parse(`6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e1${n}`),
  threadId: `thr_${n}`,
  projectId,
  verify: true,
  description: null,
  avatar: DEFAULT_AVATAR,
  createdAt: n,
});

const notStarted = (n: number): NotStarted => ({ id: coordinatorIdSchema.parse(`9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2${n}`), name: `Scout ${n}`, description: null, avatar: DEFAULT_AVATAR, createdAt: n });

const read = (coordinators: Coordinator[] | undefined, error: Error | null = null, waiting: NotStarted[] = []) => ({
  data: coordinators === undefined ? undefined : { coordinators, notStarted: waiting },
  error,
  isLoading: false,
});
const live = (status: PluginSidebarThreadsState["status"], threads = [thread(1, "a")]) => ({ status, threads, projects: [project("a")] });

test("threads group under their project, newest group first, and a thread bb no longer lists is left out", () => {
  const coordinators = [coordinator(4, "b"), coordinator(3, "a"), coordinator(2, "b"), coordinator(1, "a")];
  const threads = [thread(1, "a"), thread(2, "b"), thread(4, "b")]; // thr_3 is archived

  const view = listView(read(coordinators), { status: "ready", threads, projects: [project("a"), project("b")] });
  assert.equal(view.kind, "listed");
  assert.deepEqual(
    view.kind === "listed" && view.groups.map((g) => [g.project.id, g.rows.map((r) => r.thread.id)]),
    [
      ["b", ["thr_4", "thr_2"]],
      ["a", ["thr_1"]],
    ],
  );
});

test("the regional managers not started yet are listed apart from the groups, with no thread to find in bb's list", () => {
  const view = listView(read([coordinator(1, "a")], null, [notStarted(3), notStarted(2)]), live("ready"));
  assert.deepEqual(view.kind === "listed" && [view.notStarted.map(({ name }) => name), view.groups.map((g) => g.project.id)], [["Scout 3", "Scout 2"], ["a"]]);
  assert.equal(listView(read([], null, [notStarted(2)]), live("ready", [])).kind, "listed");
});

test("the list is empty only when both reads succeeded with nothing to list", () => {
  assert.equal(listView(read([]), live("ready")).kind, "empty");
});

test("a failed first read of the coordinators is a failure, not an empty list", () => {
  assert.equal(listView(read(undefined, new Error("offline")), live("ready")).kind, "failed");
});

test("a failed read of bb's threads is a failure, not an empty list", () => {
  assert.equal(listView(read([coordinator(1, "a")]), live("error", [])).kind, "failed");
});

test("a failed refresh keeps the coordinators it read before", () => {
  assert.equal(listView(read([coordinator(1, "a")], new Error("offline")), live("ready")).kind, "listed");
});

test("either read still loading shows neither a list nor an empty one", () => {
  assert.equal(listView({ ...read(undefined), isLoading: true }, live("ready")).kind, "loading");
  assert.equal(listView(read([]), live("loading")).kind, "loading");
});
