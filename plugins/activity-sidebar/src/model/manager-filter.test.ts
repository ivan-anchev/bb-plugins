import assert from "node:assert/strict";
import { test } from "node:test";
import type { ManagerModel, Managers } from "./activity.ts";
import { project, thread } from "./fixtures.ts";
import { managerProjects, narrowManagers } from "./manager-filter.ts";

const PROJECTS = [project("prj_a", "bb-plugins"), project("prj_b", "skills"), project("prj_c", "cherubot")];

const manager = (id: string, projectId: string): ManagerModel => ({
  thread: thread(id, { originPluginId: "regional-manager", projectId }),
  look: null,
  line: null,
  current: false,
  state: null,
  project: projectId,
});

const names = (projects: readonly { name: string }[]) => projects.map((p) => p.name);

test("managers all in one project offer no project to narrow them to", () => {
  const managers: Managers = { pinned: [manager("Sidebar", "prj_a")], unpinned: [manager("PR Reviews", "prj_a"), manager("Docs", "prj_a")] };
  assert.deepEqual(managerProjects(managers, PROJECTS), []);
});

test("managers across two or more projects offer those projects only, in the sidebar's order, pinned ones counted", () => {
  const managers: Managers = { pinned: [manager("Sidebar", "prj_c")], unpinned: [manager("PR Reviews", "prj_a")] };
  assert.deepEqual(names(managerProjects(managers, PROJECTS)), ["bb-plugins", "cherubot"]);
});

test("narrowed to a project, only its managers stay, pinned and not; null keeps them all", () => {
  const managers: Managers = { pinned: [manager("Sidebar", "prj_c"), manager("Kit", "prj_a")], unpinned: [manager("PR Reviews", "prj_a"), manager("Docs", "prj_b")] };
  const narrowed = narrowManagers(managers, "prj_a");
  assert.deepEqual([narrowed.pinned, narrowed.unpinned].map((ms) => ms.map((m) => m.thread.id)), [["Kit"], ["PR Reviews"]]);
  assert.equal(narrowManagers(managers, null), managers);
});
