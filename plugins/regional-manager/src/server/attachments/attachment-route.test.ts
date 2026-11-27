import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { handoffIdSchema } from "../../model/agent/handoff.ts";
import { attachmentIdSchema, type CopiedAttachment } from "../../model/attachment.ts";
import { filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../store/test-store.ts";
import { attachmentRoute } from "./attachment-route.ts";

// The route serves an attachment's bytes, as stored with its handoff, only within the manager the URL
// names; anything else is a 404.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHOT: CopiedAttachment = { id: attachmentIdSchema.parse(randomUUID()), name: "sheet.png", about: "Criterion 1: the sheet", type: "image/png", size: PNG.byteLength, bytes: PNG };

/** The route over a real store holding MANAGER's blocked handoff with SHOT attached. */
function route() {
  const { store } = freshStore();
  const issue = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agentId = startAgent(store, issue.id, "agent-1");
  store.insertHandoff(
    { id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId: issue.id, agentId, at: 3_000, turnSeq: 1, status: "blocked", summary: "Stuck", did: [], evidence: [], concerns: [], deviations: [], findings: [], attachments: [SHOT] },
    { kind: "unread", reason: "unused" },
    null,
  );
  return attachmentRoute(store);
}

/** The part of hono's request the route reads: `?manager=` and `?id=`. */
const request = (query: Record<string, string>) => ({ req: { query: (name: string) => query[name] } });

test("a manager's own attachment is its stored bytes, served as their stored type, never sniffed or run", async () => {
  const response = route()(request({ manager: MANAGER, id: SHOT.id }));

  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), String(PNG.byteLength));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
});

test("the same id under another manager, a malformed id, an unknown id or no manager is a 404", async () => {
  const handle = route();
  const queries: Record<string, string>[] = [{ manager: OTHER_MANAGER, id: SHOT.id }, { manager: MANAGER, id: "../data.db" }, { manager: MANAGER, id: randomUUID() }, { id: SHOT.id }];
  for (const query of queries) {
    const response = handle(request(query));
    assert.equal(response.status, 404, JSON.stringify(query));
    assert.equal(await response.text(), "Not found");
  }
});
