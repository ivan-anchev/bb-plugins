import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorIdSchema } from "../../model/role.ts";
import { managerSubPath, NEW_SUBPATH, pageOf } from "./routes.ts";

const ID = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");

test("each page's subPath leads back to it", () => {
  assert.deepEqual(pageOf(""), { kind: "list" });
  assert.deepEqual(pageOf(NEW_SUBPATH), { kind: "new" });
  // why literal: 0.4.0's links to a manager's page are board/<id>, and must still land on it.
  assert.equal(managerSubPath(ID), `board/${ID}`);
  assert.deepEqual(pageOf(`board/${ID}`), { kind: "manager", coordinatorId: ID });
});

test("a manager path whose id isn't a coordinator id, or that goes on past it, and the retired Memory page's, show the list", () => {
  for (const subPath of ["board", "board/..%2F..", "board/not-an-id", `board/${ID}/i1`, `memory/${ID}`, `elsewhere/${ID}`]) assert.deepEqual(pageOf(subPath), { kind: "list" }, subPath);
});
