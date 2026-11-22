import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachmentIdSchema, noteIdSchema, type Attachment } from "../../contract.ts";
import { memoryStorage } from "../memory-storage.ts";
import { openStore } from "../store.ts";
import { openMediaFiles } from "./media-files.ts";
import { mediaRoute } from "./media-route.ts";

const BYTES = "0123456789".repeat(100);
const VIDEO: Attachment = { id: attachmentIdSchema.parse("att_00000000-0000-4000-8000-000000000001"), name: "rec.mp4", mimeType: "video/mp4", sizeBytes: 1_000 };

async function route() {
  const store = openStore(memoryStorage().storage);
  const media = openMediaFiles(join(mkdtempSync(join(tmpdir(), "notes-route-")), "data.db"));
  store.insert({ id: noteIdSchema.parse("note_00000000-0000-4000-8000-000000000001"), createdAt: 1, quote: null, body: { text: "", mentions: [] }, attachments: [VIDEO] });
  await media.write(VIDEO.id, Buffer.from(BYTES));
  return { handle: mediaRoute(store, media), media };
}

function request(id: string | undefined, range?: string) {
  return {
    req: {
      query: (name: string) => (name === "id" ? id : undefined),
      header: (name: string) => (name.toLowerCase() === "range" ? range : undefined),
    },
  };
}

test("no Range sends the whole file with its stored type and caching headers", async () => {
  const { handle } = await route();

  const response = await handle(request(VIDEO.id));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), BYTES);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "1000");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "private, max-age=31536000, immutable");
});

test("a Range sends 206 with exactly those bytes and where they sit", async () => {
  const { handle } = await route();

  const response = await handle(request(VIDEO.id, "bytes=10-19"));

  assert.equal(response.status, 206);
  assert.equal(await response.text(), "0123456789");
  assert.equal(response.headers.get("content-range"), "bytes 10-19/1000");
  assert.equal(response.headers.get("content-length"), "10");
});

test("a Range past the end is 416 with the file's size", async () => {
  const { handle } = await route();

  const response = await handle(request(VIDEO.id, "bytes=1000-"));

  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */1000");
});

test("an id that is missing, malformed or a path is 404", async () => {
  const { handle } = await route();

  for (const id of [undefined, "", "../x", "att_../../data.db", `${VIDEO.id}/../x`]) {
    assert.equal((await handle(request(id))).status, 404, String(id));
  }
});

test("an id no note holds, or whose file is gone, is 404", async () => {
  const { handle, media } = await route();

  assert.equal((await handle(request("att_00000000-0000-4000-8000-000000000009"))).status, 404);
  await media.remove([VIDEO.id]);
  assert.equal((await handle(request(VIDEO.id))).status, 404);
});
