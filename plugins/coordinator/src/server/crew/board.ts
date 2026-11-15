// The board: each crew of a coordinating thread joined with its thread as bb lists it now, and the
// digest. Read whole on every call; bb's thread events only say when to read again.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Board, BoardRow } from "../../contract.ts";
import { environmentOf, type Crew } from "../../model/crew.ts";
import { crewState, type CrewThread } from "../../model/crew-state.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store.ts";
import { currentHandoff, type TurnsBb } from "./handoffs.ts";

/** A crew's thread as the board reads it. */
type ListedThread = CrewThread & { id: string; environmentBranchName: string | null; environmentHostId: string | null; archivedAt: number | null; deletedAt: number | null };

type ListArgs = { threadIds: string[]; includeHidden: true; limit: number };

/** The part of bb that lists threads by id, with the fields its caller reads. */
type ListBb<Thread> = { sdk: { threads: { list(args: ListArgs): Promise<Thread[]> } } };

/** The part of bb the board reads: crews' threads and their turns. */
export type BoardBb = ListBb<ListedThread> & TurnsBb;

// bb lists at most 200 threads by id per call.
const IDS_PER_LIST = 200;

/**
 * The threads among `threadIds` that are neither archived nor deleted, hidden ones included. why by
 * id, not by parent: a crew someone moved under another thread is still this coordinating
 * thread's crew. why filter here: bb lists archived threads by id too.
 */
export async function listedThreads<Thread extends { id: string; archivedAt: number | null; deletedAt: number | null }>(bb: ListBb<Thread>, threadIds: string[]): Promise<Map<string, Thread>> {
  const listed = new Map<string, Thread>();
  for (let start = 0; start < threadIds.length; start += IDS_PER_LIST) {
    const threadIdsOfPage = threadIds.slice(start, start + IDS_PER_LIST);
    for (const thread of await bb.sdk.threads.list({ threadIds: threadIdsOfPage, includeHidden: true, limit: IDS_PER_LIST })) {
      if (thread.archivedAt === null && thread.deletedAt === null) listed.set(thread.id, thread);
    }
  }
  return listed;
}

const DIGEST = memoryFileSchema.parse("DIGEST.md");

export function createBoard(bb: BoardBb, store: Pick<Store, "crews" | "coordinator" | "latestHandoff" | "verifies">, memory: MemoryRoot) {
  async function rows(id: CoordinatorId): Promise<BoardRow[]> {
    const coordinator = store.coordinator(id);
    // why: a coordinating thread starts crews through its tools, which it gets once its thread is bound.
    if (coordinator === null) return [];
    const crews = store.crews(id);
    // why the coordinating thread too: a draft's editor shows the machine its worktree would be on.
    const threads = await listedThreads(bb, [coordinator.threadId, ...crews.flatMap((crew) => (crew.launch.kind === "started" ? [crew.launch.threadId] : []))]);
    const environmentHostId = threads.get(coordinator.threadId)?.environmentHostId ?? null;
    return Promise.all(
      crews.map(async (crew) => {
        const threadId = crew.launch.kind === "started" ? crew.launch.threadId : null;
        const thread = threadId === null ? null : (threads.get(threadId) ?? null);
        const handoff = isOpen(crew) && thread !== null ? await currentHandoff(bb, store, crew) : null;
        const draft = draftOf(crew, { projectId: coordinator.projectId, environmentHostId });
        const verdict = handoff?.status === "done" ? handoff.verdict : null;
        return { crewId: crew.id, title: crew.title, threadId, branch: thread?.environmentBranchName ?? null, ...crewState(crew, thread, handoff), verdict, draft };
      }),
    );
  }

  return {
    rows,

    /** The board as the user sees it: the verification switch, the digest, then every crew's row. */
    async read(id: CoordinatorId): Promise<Board> {
      const files = memory.of(id);
      const text = files.read(DIGEST).text;
      const modifiedAt = files.modifiedAt(DIGEST);
      return {
        verify: store.verifies(id),
        digest: text === null || modifiedAt === null ? null : { content: text.content, modifiedAt },
        rows: await rows(id),
      };
    },
  };
}

export type BoardReader = ReturnType<typeof createBoard>;

/** A crew whose thread runs and that nobody closed: the only kind whose handoff can place it. */
export const isOpen = (crew: Crew): crew is Crew & { launch: { kind: "started" } } => crew.launch.kind === "started" && crew.closed === null;

/** A crew that is still a draft, as its row shows it and its editor starts from. */
function draftOf(crew: Crew, coordinator: { projectId: string; environmentHostId: string | null }): BoardRow["draft"] {
  if (crew.launch.kind !== "draft" || crew.closed !== null) return null;
  const { brief, doneCriteria, execution, placement } = crew;
  return { projectId: coordinator.projectId, brief, doneCriteria, execution, environment: environmentOf(placement, coordinator.environmentHostId) };
}
