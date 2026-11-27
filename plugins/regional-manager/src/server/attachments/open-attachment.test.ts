import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { handoffIdSchema } from "../../model/agent/handoff.ts";
import { attachmentIdSchema, type CopiedAttachment } from "../../model/attachment.ts";
import { filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../store/test-store.ts";
import { attachmentHandlers } from "./open-attachment.ts";

type OpenAttachmentBb = Parameters<typeof attachmentHandlers>[0];

// A Markdown attachment opens in bb's side panel: the plugin writes it into its manager's thread
// storage, where bb's preview can open it, and names it there.

const NOTES = Buffer.from("# Findings\n\nThe sheet opens on **WEB-1**.\n");
const MD: CopiedAttachment = { id: attachmentIdSchema.parse(randomUUID()), name: "findings.md", about: "What the run found", type: "text/markdown; charset=utf-8", size: NOTES.byteLength, bytes: NOTES };
const PNG: CopiedAttachment = { id: attachmentIdSchema.parse(randomUUID()), name: "sheet.png", about: "The sheet", type: "image/png", size: 4, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
const STORAGE = { hostId: "host_bb", storageRootPath: "/Users/ivan/.bb/thread-storage/thr_manager_1" };

/** The handler over a real store holding MANAGER's handoff with MD and PNG, and bb's storage as strict as the host: only a thread it has, and every write recorded. */
function opener() {
  const { store } = freshStore();
  const issue = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agentId = startAgent(store, issue.id, "agent-1");
  store.insertHandoff(
    { id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId: issue.id, agentId, at: 3_000, turnSeq: 1, status: "blocked", summary: "Stuck", did: [], evidence: [], concerns: [], deviations: [], findings: [], attachments: [MD, PNG] },
    { kind: "unread", reason: "unused" },
    null,
  );
  const writes: Parameters<OpenAttachmentBb["sdk"]["files"]["write"]>[0][] = [];
  const bb: OpenAttachmentBb = {
    sdk: {
      threads: {
        storageLocation: async ({ threadId }) => {
          if (threadId !== "thr_manager_1") throw new Error(`No thread ${threadId}`);
          return STORAGE;
        },
      },
      files: {
        write: async (args) => {
          if (!args.path.startsWith(`${args.rootPath}/`)) throw new Error("Path is outside the root");
          writes.push(args);
          return {};
        },
      },
    },
  };
  return { open: attachmentHandlers(bb, store).openAttachment, writes };
}

test("opening a Markdown attachment writes its bytes into its manager's thread storage and names that thread and the path in it; opening again writes the same file again", async () => {
  const { open, writes } = opener();
  const target = { threadId: "thr_manager_1", path: `attachments/${MD.id}/findings.md` };

  assert.deepEqual(await open({ coordinatorId: MANAGER, id: MD.id }), target);
  assert.deepEqual(await open({ coordinatorId: MANAGER, id: MD.id }), target);

  const write = { hostId: "host_bb", rootPath: STORAGE.storageRootPath, path: `${STORAGE.storageRootPath}/attachments/${MD.id}/findings.md`, content: NOTES.toString("base64"), contentEncoding: "base64", createParents: true };
  assert.deepEqual(writes, [write, write]);
});

test("an attachment that downloads, another manager's, or an unknown one is refused and writes nothing", async () => {
  const { open, writes } = opener();
  await assert.rejects(async () => open({ coordinatorId: MANAGER, id: PNG.id }), /sheet\.png downloads; only a Markdown attachment opens in the panel/);
  await assert.rejects(async () => open({ coordinatorId: OTHER_MANAGER, id: MD.id }), /There is no attachment/);
  await assert.rejects(async () => open({ coordinatorId: MANAGER, id: attachmentIdSchema.parse(randomUUID()) }), /There is no attachment/);
  assert.deepEqual(writes, []);
});
