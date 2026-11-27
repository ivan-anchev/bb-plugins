// Copies the files an agent attaches to its handoff into the plugin's keeping, as the handoff is
// recorded: each read once, through bb, from the calling thread's own environment, on whichever
// machine that is (a worktree here, a sandbox elsewhere), while the thread is awake to call its tool
// anyway. A file it can't take is refused with a reason, and never refuses the handoff around it.
// Nothing here stores anything: the store does, in the handoff's transaction.
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, relative } from "node:path/posix";
import { aboutSchema, ATTACHMENT_LIMITS, attachmentIdSchema, attachmentType, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type CopiedAttachment, type GivenAttachment } from "../../model/attachment.ts";
import { listedThreads } from "../agents/threads.ts";

/** A file that wasn't attached, by the path it was given, and why, in words the caller can act on. */
type Refusal = { path: string; reason: string };

export type CopyIn = { copied: CopiedAttachment[]; refused: Refusal[] };

type ListedThread = { id: string; environmentId: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb the copy uses, down to the fields it reads. */
type CopyInBb = {
  sdk: {
    threads: {
      list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]>;
      storageLocation(args: { threadId: string }): Promise<{ hostId: string; storageRootPath: string }>;
    };
    environments: { get(args: { environmentId: string }): Promise<{ hostId: string; path: string | null }> };
    files: { read(args: { hostId: string; rootPath: string; path: string }): Promise<{ content: string; contentEncoding: "base64" | "utf8" }> };
  };
};

/** Copies in what the thread `threadId` attaches: each file it can take, and why each other one isn't. */
export function attachmentCopier(bb: CopyInBb) {
  return async (threadId: string, given: readonly GivenAttachment[]): Promise<CopyIn> => {
    if (given.length === 0) return { copied: [], refused: [] };
    const places = await placesOf(bb, threadId).catch((error: unknown) => ({ unread: messageOf(error) }));
    // why refuse each rather than throw: the handoff records whatever its files do.
    if ("unread" in places) return { copied: [], refused: given.map(({ path }) => ({ path, reason: `the plugin couldn't read where your environment is (${places.unread}).` })) };
    const each = await Promise.all(given.map((one, i) => (i < MAX_ATTACHMENTS ? copyOne(bb, places, one) : { path: one.path, reason: OVER_COUNT })));
    return {
      copied: each.filter((one): one is CopiedAttachment => !("reason" in one)),
      refused: each.filter((one): one is Refusal => "reason" in one),
    };
  };
}

/** The refusals as the tool's result ends with them; "" when there are none. */
export function refusedText(refused: readonly Refusal[]): string {
  if (refused.length === 0) return "";
  return `\n\nNot attached, and recorded without ${refused.length === 1 ? "it" : "them"}:\n${refused.map(({ path, reason }) => `- ${path}: ${reason}`).join("\n")}`;
}

// ------------------------------------------------------------------ layer 2

/** A place the thread's files may come from: a folder on one machine. */
type Place = { hostId: string; root: string };

const OVER_COUNT = `it is past the ${MAX_ATTACHMENTS}-file cap; attach the ${MAX_ATTACHMENTS} that matter most.`;

/**
 * Where the thread's files may come from: its environment's workspace, on the environment's machine,
 * and its thread storage, on the machine bb keeps it on. why both: evidence belongs in thread storage,
 * as an untracked file in the worktree fails the clean-tree check, while a gitignored output such as
 * test-results/ sits in the workspace.
 */
async function placesOf(bb: CopyInBb, threadId: string): Promise<Place[]> {
  const [thread, storage] = await Promise.all([listedThreads(bb, [threadId]).then((threads) => threads.get(threadId)), bb.sdk.threads.storageLocation({ threadId })]);
  const environment = thread?.environmentId == null ? null : await bb.sdk.environments.get({ environmentId: thread.environmentId });
  const workspace = environment?.path == null ? [] : [{ hostId: environment.hostId, root: environment.path }];
  return [...workspace, { hostId: storage.hostId, root: storage.storageRootPath }];
}

/** One file copied in, or why not. Cheapest refusals first: its about line, type and place need no read. */
async function copyOne(bb: CopyInBb, places: readonly Place[], { path, about: given }: GivenAttachment): Promise<CopiedAttachment | Refusal> {
  const about = aboutSchema.safeParse(given);
  if (!about.success) return { path, reason: "its about line must be one line of 1 to 160 characters." };
  const name = basename(path);
  const type = attachmentType(name);
  if (type === null) return { path, reason: `its type isn't one the plugin keeps (${ATTACHMENT_LIMITS}); convert it, as a screenshot to .png or a recording to .mp4.` };
  const place = placeOf(places, path);
  if (place === null) return { path, reason: `it isn't in your environment; save it under ${places.map(({ root }) => root).join(" or ")}, and pass its absolute path.` };
  const read = await bb.sdk.files.read({ hostId: place.hostId, rootPath: place.root, path }).catch((error: unknown) => ({ failed: messageOf(error) }));
  if ("failed" in read) return { path, reason: `it couldn't be read (${read.failed}).` };
  const bytes = Buffer.from(read.content, read.contentEncoding);
  // why after the read: bb's files API has no stat, so the size is known only once it is read.
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { path, reason: `it is over the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB cap for one file; trim or compress it.` };
  if (bytes.byteLength === 0) return { path, reason: "it is empty." };
  return { id: attachmentIdSchema.parse(randomUUID()), name, about: about.data, type, size: bytes.byteLength, bytes };
}

/**
 * The place `path` lies in, or null: it must be absolute and inside one place's root. why lexical:
 * the check stops a mistake, not a hostile agent, whose shell already reads anything on its machine.
 */
function placeOf(places: readonly Place[], path: string): Place | null {
  if (!isAbsolute(path)) return null;
  return places.find(({ root }) => isInside(root, path)) ?? null;
}

const isInside = (root: string, path: string): boolean => {
  const within = relative(root, path);
  // why "../" and not "..": a file named "..notes.txt" inside the root is inside it.
  return within !== "" && within !== ".." && !within.startsWith("../") && !isAbsolute(within);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
