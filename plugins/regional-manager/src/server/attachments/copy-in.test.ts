import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentCopier, refusedText } from "./copy-in.ts";

type CopyInBb = Parameters<typeof attachmentCopier>[0];

// Copy-in reads each attached file once, through bb, from where the calling thread's files are: its
// thread storage, on the machine bb keeps it on, and its environment's workspace, on the
// environment's machine. A file it can't take is refused alone, with a reason, and the rest are
// still copied.

const THREAD = "thr_agent";
const STORAGE = { hostId: "host_bb", storageRootPath: "/Users/ivan/.bb/thread-storage/thr_agent" };
const WORKSPACE = { hostId: "host_sandbox", path: "/home/boat/work/webhooks" };
const MB = 1024 * 1024;

/**
 * bb as strict as the host: its files API reads only under the root it is given, on the host it is
 * given, answers a missing file with an error, and sends binary as base64. `files` are by host and
 * path; every read is recorded.
 */
function fakeBb(files: Record<string, Buffer>, environmentId: string | null = "env_1") {
  const reads: { hostId: string; rootPath: string; path: string }[] = [];
  const bb: CopyInBb = {
    sdk: {
      threads: {
        list: async ({ threadIds }) => threadIds.map((id) => ({ id, environmentId, archivedAt: null, deletedAt: null })),
        storageLocation: async ({ threadId }) => {
          if (threadId !== THREAD) throw new Error(`No thread ${threadId}`);
          return STORAGE;
        },
      },
      environments: {
        get: async ({ environmentId: id }) => {
          if (id !== environmentId) throw new Error(`No environment ${id}`);
          return WORKSPACE;
        },
      },
      files: {
        read: async (args) => {
          reads.push(args);
          if (!args.path.startsWith(`${args.rootPath}/`)) throw new Error("Path is outside the root");
          const bytes = files[`${args.hostId}:${args.path}`];
          if (bytes === undefined) throw new Error(`ENOENT: no such file, open '${args.path}'`);
          const text = bytes.toString("utf8");
          // As bb does: text comes back as utf8 when it round-trips, anything else as base64.
          return Buffer.from(text, "utf8").equals(bytes) ? { content: text, contentEncoding: "utf8" } : { content: bytes.toString("base64"), contentEncoding: "base64" };
        },
      },
    },
  };
  return { bb, reads };
}

const inStorage = (name: string) => `${STORAGE.storageRootPath}/qa/${name}`;
const inWorkspace = (name: string) => `${WORKSPACE.path}/test-results/${name}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

test("a file in thread storage is read on the storage's host under its root, and one in the workspace on the environment's, each copied with its bytes, its base name and its type by extension", async () => {
  const { bb, reads } = fakeBb({ [`host_bb:${inStorage("sheet.png")}`]: PNG, [`host_sandbox:${inWorkspace("e2e.log")}`]: Buffer.from("38 specs green\n") });

  const { copied, refused } = await attachmentCopier(bb)(THREAD, [
    { path: inStorage("sheet.png"), about: "Criterion 2: the sheet open" },
    { path: inWorkspace("e2e.log"), about: "Full e2e run" },
  ]);

  assert.deepEqual(refused, []);
  assert.deepEqual(reads, [
    { hostId: "host_bb", rootPath: STORAGE.storageRootPath, path: inStorage("sheet.png") },
    { hostId: "host_sandbox", rootPath: WORKSPACE.path, path: inWorkspace("e2e.log") },
  ]);
  assert.deepEqual(
    copied.map(({ id: _id, bytes, ...record }) => ({ ...record, bytes: Buffer.from(bytes) })),
    [
      { name: "sheet.png", about: "Criterion 2: the sheet open", type: "image/png", size: PNG.byteLength, bytes: PNG },
      { name: "e2e.log", about: "Full e2e run", type: "text/plain; charset=utf-8", size: 15, bytes: Buffer.from("38 specs green\n") },
    ],
  );
  assert.equal(new Set(copied.map(({ id }) => id)).size, 2, "each gets an id of its own");
});

test("a .mov recording is kept, served as QuickTime video", async () => {
  const { bb } = fakeBb({ [`host_bb:${inStorage("flow.MOV")}`]: PNG });
  const { copied, refused } = await attachmentCopier(bb)(THREAD, [{ path: inStorage("flow.MOV"), about: "The flow, recorded" }]);
  assert.deepEqual(refused, []);
  assert.deepEqual(
    copied.map(({ name, type }) => ({ name, type })),
    [{ name: "flow.MOV", type: "video/quicktime" }],
  );
});

test("each file it can't take is refused alone with why, and the others are still copied: an unknown type, a path outside both places, one over 10 MB and an empty one", async () => {
  const { bb, reads } = fakeBb({
    [`host_bb:${inStorage("shot.png")}`]: PNG,
    [`host_bb:${inStorage("huge.png")}`]: Buffer.alloc(10 * MB + 1, 1),
    [`host_bb:${inStorage("empty.log")}`]: Buffer.alloc(0),
    [`host_bb:${inStorage("bundle.zip")}`]: PNG,
    [`host_bb:/tmp/elsewhere.png`]: PNG,
  });

  const { copied, refused } = await attachmentCopier(bb)(THREAD, [
    { path: inStorage("bundle.zip"), about: "Zipped" },
    { path: "/tmp/elsewhere.png", about: "Outside" },
    { path: inStorage("shot.png"), about: "Kept" },
    { path: inStorage("huge.png"), about: "Too big" },
    { path: inStorage("empty.log"), about: "Nothing" },
  ]);

  assert.deepEqual(
    copied.map(({ name, about }) => ({ name, about })),
    [{ name: "shot.png", about: "Kept" }],
  );
  assert.equal(refused.length, 4);
  const why = Object.fromEntries(refused.map(({ path, reason }) => [path, reason]));
  assert.match(why[inStorage("bundle.zip")] ?? "", /^its type isn't one the plugin keeps \(up to 5 files of at most 10 MB each, of type \.png, .*\.mov.*\); convert it/);
  assert.equal(why["/tmp/elsewhere.png"], `it isn't in your environment; save it under ${WORKSPACE.path} or ${STORAGE.storageRootPath}, and pass its absolute path.`);
  assert.equal(why[inStorage("huge.png")], "it is over the 10 MB cap for one file; trim or compress it.");
  assert.equal(why[inStorage("empty.log")], "it is empty.");
  assert.deepEqual(
    reads.map(({ path }) => path),
    [inStorage("shot.png"), inStorage("huge.png"), inStorage("empty.log")],
    "no read for a type it doesn't keep, nor for a path outside",
  );
});

test("a missing file is refused with bb's error, and a sixth file past the cap is refused unread, while the others are copied", async () => {
  const shot = (n: number) => inStorage(`shot-${n}.png`);
  const { bb, reads } = fakeBb(Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`host_bb:${shot(n)}`, PNG])));

  const { copied, refused } = await attachmentCopier(bb)(THREAD, [
    { path: shot(1), about: "One" },
    { path: inStorage("gone.png"), about: "Missing" },
    { path: shot(2), about: "Two" },
    { path: shot(3), about: "Three" },
    { path: shot(4), about: "Four" },
    { path: shot(5), about: "The sixth file" },
  ]);

  assert.deepEqual(
    copied.map(({ name }) => name),
    ["shot-1.png", "shot-2.png", "shot-3.png", "shot-4.png"],
  );
  assert.equal(refused.length, 2);
  assert.match(refused[0]?.reason ?? "", /^it couldn't be read \(ENOENT: no such file, open '.*gone\.png'\)\.$/);
  assert.equal(refused[0]?.path, inStorage("gone.png"));
  assert.deepEqual(refused[1], { path: shot(5), reason: "it is past the 5-file cap; attach the 5 that matter most." });
  assert.ok(!reads.some(({ path }) => path === shot(5)), "the sixth is never read");
});

test("a path reaches bb's read byte for byte: no trimming of spaces or invisible characters", async () => {
  const odd = inStorage(" shot​ .png");
  const { bb, reads } = fakeBb({ [`host_bb:${odd}`]: PNG });
  const { copied } = await attachmentCopier(bb)(THREAD, [{ path: odd, about: "Odd name" }]);
  assert.deepEqual(
    reads.map(({ path }) => path),
    [odd],
  );
  assert.equal(copied[0]?.name, " shot​ .png");
});

test("a thread with no environment takes files from its thread storage only", async () => {
  const { bb } = fakeBb({ [`host_bb:${inStorage("sheet.png")}`]: PNG }, null);
  const { copied, refused } = await attachmentCopier(bb)(THREAD, [
    { path: inStorage("sheet.png"), about: "Kept" },
    { path: inWorkspace("e2e.log"), about: "No workspace" },
  ]);
  assert.deepEqual(
    copied.map(({ name }) => name),
    ["sheet.png"],
  );
  assert.deepEqual(refused, [{ path: inWorkspace("e2e.log"), reason: `it isn't in your environment; save it under ${STORAGE.storageRootPath}, and pass its absolute path.` }]);
});

test("when bb can't say where the thread's files are, every file is refused with why, and nothing throws", async () => {
  const { bb } = fakeBb({});
  const { copied, refused } = await attachmentCopier(bb)("thr_gone", [{ path: inStorage("sheet.png"), about: "Lost" }]);
  assert.deepEqual(copied, []);
  assert.deepEqual(refused, [{ path: inStorage("sheet.png"), reason: "the plugin couldn't read where your environment is (No thread thr_gone)." }]);
});

test("the refusals end the tool's result under Not attached, one line each with its path and reason; none adds nothing", () => {
  assert.equal(refusedText([]), "");
  assert.equal(refusedText([{ path: "/s/a.zip", reason: "its type isn't kept." }]), "\n\nNot attached, and recorded without it:\n- /s/a.zip: its type isn't kept.");
  assert.equal(refusedText([{ path: "/s/a.zip", reason: "one." }, { path: "/s/b.png", reason: "two." }]), "\n\nNot attached, and recorded without them:\n- /s/a.zip: one.\n- /s/b.png: two.");
});
