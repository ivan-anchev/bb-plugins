// The board: each crew of a coordinating thread joined with its thread as bb lists it now, and the
// digest. Read whole on every call; bb's thread events only say when to read again.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Board, BoardRow } from "../../contract.ts";
import { crewState, type CrewThread } from "../../model/crew-state.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store.ts";

/** A crew's thread as the board reads it. */
type ListedThread = CrewThread & { id: string; environmentBranchName: string | null; archivedAt: number | null; deletedAt: number | null };

type ListArgs = { threadIds: string[]; includeHidden: true; limit: number };

/** The part of bb the board reads. */
export type BoardBb = { sdk: { threads: { list(args: ListArgs): Promise<ListedThread[]> } } };

// bb lists at most 200 threads by id per call.
const IDS_PER_LIST = 200;

/**
 * The threads among `threadIds` that are neither archived nor deleted, hidden ones included. why by
 * id, not by parent: a crew someone moved under another thread is still this coordinating
 * thread's crew. why filter here: bb lists archived threads by id too.
 */
export async function listedThreads(bb: BoardBb, threadIds: string[]): Promise<Map<string, ListedThread>> {
  const listed = new Map<string, ListedThread>();
  for (let start = 0; start < threadIds.length; start += IDS_PER_LIST) {
    const threadIdsOfPage = threadIds.slice(start, start + IDS_PER_LIST);
    for (const thread of await bb.sdk.threads.list({ threadIds: threadIdsOfPage, includeHidden: true, limit: IDS_PER_LIST })) {
      if (thread.archivedAt === null && thread.deletedAt === null) listed.set(thread.id, thread);
    }
  }
  return listed;
}

const DIGEST = memoryFileSchema.parse("DIGEST.md");

export function createBoard(bb: BoardBb, store: Pick<Store, "crews">, memory: MemoryRoot) {
  async function rows(id: CoordinatorId): Promise<BoardRow[]> {
    const crews = store.crews(id);
    const threads = await listedThreads(bb, crews.flatMap((crew) => (crew.launch.kind === "started" ? [crew.launch.threadId] : [])));
    return crews.map((crew) => {
      const threadId = crew.launch.kind === "started" ? crew.launch.threadId : null;
      const thread = threadId === null ? null : (threads.get(threadId) ?? null);
      return { crewId: crew.id, title: crew.title, threadId, branch: thread?.environmentBranchName ?? null, ...crewState(crew, thread) };
    });
  }

  return {
    rows,

    /** The board as the user sees it: the digest, then every crew's row. */
    async read(id: CoordinatorId): Promise<Board> {
      const files = memory.of(id);
      const text = files.read(DIGEST).text;
      const modifiedAt = files.modifiedAt(DIGEST);
      return { digest: text === null || modifiedAt === null ? null : { content: text.content, modifiedAt }, rows: await rows(id) };
    },
  };
}

export type BoardReader = ReturnType<typeof createBoard>;
