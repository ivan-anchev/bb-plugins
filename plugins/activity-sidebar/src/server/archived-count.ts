import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { ARCHIVED_COUNT_TAG, type ArchivedCount } from "../contract.ts";

/** The events that can change the count; server.ts hands each to `changed`. */
export const ARCHIVE_EVENTS = ["thread.archived", "thread.unarchived", "thread.deleted"] as const;

/** What the count reads of a thread, from a listed row or an event's payload alike. */
type Counted = Pick<Awaited<ReturnType<PluginBbSdk["threads"]["list"]>>[number], "parentThreadId" | "visibility" | "projectId">;

type ArchivedLister = { list(args: { archived: true; hasParent: false; limit: number; offset: number }): Promise<readonly Counted[]> };

type Deps = { threads: ArchivedLister; rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate"> };

export type ArchivedCounter = ReturnType<typeof openArchivedCount>;

const PAGE = 500;

export function openArchivedCount({ threads, rpc }: Deps) {
  let counting: Promise<ArchivedCount> | null = null;

  return {
    read(): Promise<ArchivedCount> {
      if (counting !== null) return counting;
      const run = listArchivedParents(threads).then(countShelved);
      run.catch(() => {
        if (counting === run) counting = null;
      });
      counting = run;
      return run;
    },

    changed(thread: Counted): void {
      if (!onShelf(thread)) return;
      counting = null;
      rpc.experimental_invalidate([ARCHIVED_COUNT_TAG]);
    },
  };
}

async function listArchivedParents(threads: ArchivedLister): Promise<Counted[]> {
  const all: Counted[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await threads.list({ archived: true, hasParent: false, limit: PAGE, offset });
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

function countShelved(threads: readonly Counted[]): ArchivedCount {
  const shelved = threads.filter(onShelf);
  const byProject: Record<string, number> = {};
  for (const t of shelved) byProject[t.projectId] = (byProject[t.projectId] ?? 0) + 1;
  return { total: shelved.length, byProject };
}

function onShelf(t: Counted): boolean {
  return t.parentThreadId === null && t.visibility === "visible";
}
