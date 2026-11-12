import assert from "node:assert/strict";
import { test } from "node:test";
import type { Visit } from "../contract.ts";
import { repoSchema } from "../github/repo.ts";
import { lastOpenedProject } from "./last-opened.ts";

const visit = (projectId: string, number: number, openedAt: number): Visit => ({ projectId, repo: repoSchema.parse("octo-org/widgets"), number, openedAt });

test("the badge counts the project of the latest visit, whatever order the visits are listed in", () => {
  assert.equal(lastOpenedProject([visit("proj_b", 2, 2_000), visit("proj_a", 1, 1_000)]), "proj_b");
  assert.equal(lastOpenedProject([visit("proj_a", 1, 1_000), visit("proj_b", 2, 2_000)]), "proj_b");
});

test("before any visit there is no project to count", () => {
  assert.equal(lastOpenedProject([]), null);
});
