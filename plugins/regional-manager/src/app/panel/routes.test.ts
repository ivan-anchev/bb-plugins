import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { managerSubPath, NEW_SUBPATH, pageOf } from "./routes.ts";

const ID = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");

test("each page's subPath leads back to it", () => {
  assert.deepEqual(pageOf(""), { kind: "list" });
  assert.deepEqual(pageOf(NEW_SUBPATH), { kind: "new" });
  // why literal: 0.4.0's links to a manager's page are board/<id>, and must still land on it.
  assert.equal(managerSubPath(ID), `board/${ID}`);
  assert.deepEqual(pageOf(`board/${ID}`), { kind: "manager", coordinatorId: ID });
  // why literal: an issue link a manager wrote, in a message, lands here where no overlay caught it.
  assert.deepEqual(pageOf(`issue/${ID}/BBP-24`), { kind: "issue", link: { coordinatorId: ID, issueId: issueIdSchema.parse("BBP-24") } });
});

test("a manager or issue path whose ids aren't ids, or that goes on past them, and the retired Memory page's, show the list", () => {
  for (const subPath of ["board", "board/..%2F..", "board/not-an-id", `board/${ID}/WEB-1`, `memory/${ID}`, `elsewhere/${ID}`, `issue/${ID}`, `issue/${ID}/web-1`, `issue/not-an-id/WEB-1`]) assert.deepEqual(pageOf(subPath), { kind: "list" }, subPath);
});
