import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorIdSchema } from "../../model/role.ts";
import { coordinatorSubPath, NEW_SUBPATH, pageOf } from "./routes.ts";

const ID = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");

test("each page's subPath leads back to it", () => {
  assert.deepEqual(pageOf(""), { kind: "list" });
  assert.deepEqual(pageOf(NEW_SUBPATH), { kind: "new" });
  assert.deepEqual(pageOf(coordinatorSubPath("memory", ID)), { kind: "memory", coordinatorId: ID });
  assert.deepEqual(pageOf(coordinatorSubPath("board", ID)), { kind: "board", coordinatorId: ID });
});

test("a memory or board path whose id isn't a coordinator id, or that goes on past it, shows the list", () => {
  for (const subPath of ["memory", "memory/..%2F..", "memory/not-an-id", `memory/${ID}/PLAN.md`, "board", `board/${ID}/i1`, `elsewhere/${ID}`]) assert.deepEqual(pageOf(subPath), { kind: "list" }, subPath);
});
