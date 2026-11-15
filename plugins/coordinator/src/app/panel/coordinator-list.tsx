// The panel's root page: every coordinating thread, under its project, newest first. A row opens
// its thread.
import {
  experimental_Icon as Icon,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { DISPLAY_NAME } from "../../name.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { listView } from "./coordinator-groups.ts";

export function CoordinatorList({ ref }: { ref: Ref<HTMLDivElement> }) {
  const read = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  const live = useSidebarThreads();
  const view = listView(read, live);

  return (
    // why the tab stop: the list scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the list: {read.error.message}</ReadFailure>}
        {live.status === "error" && <ReadFailure>Could not read bb's threads.</ReadFailure>}
        {view.kind === "empty" && <Empty />}
        {view.kind === "listed" &&
          view.groups.map((group) => (
            <section key={group.project.id} aria-labelledby={`project-${group.project.id}`} className="flex flex-col gap-1">
              <h2 id={`project-${group.project.id}`} className="px-2 text-xs font-medium text-muted-foreground">
                {group.project.name}
              </h2>
              <ul className="flex flex-col">
                {group.threads.map((thread) => (
                  <li key={thread.id}>
                    <Row thread={thread} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}

function Row({ thread }: { thread: PluginSidebarThread }) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate.toThread(thread.id)}
      className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <ThreadStatusGlyph indicator={thread.indicator} size="compact" />
      </span>
      <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
    </button>
  );
}

// why no button here: New sits in the panel's title bar, one primary action per screen.
function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <Icon name="Workflow" className="size-6 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No {DISPLAY_NAME} threads yet</p>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">Press New and give one a goal. It plans the work and keeps its memory in files.</p>
      </div>
    </div>
  );
}
