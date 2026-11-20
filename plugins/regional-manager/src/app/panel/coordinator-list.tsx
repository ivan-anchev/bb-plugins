// The panel's root page: the regional managers not started yet, then every other one under its
// project, newest first, each by its avatar, its name and its description. A row opens the manager's
// thread once started, its page until then.
import { experimental_Icon as Icon, experimental_useRpcQuery, experimental_useSidebarThreads as useSidebarThreads, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ReactNode, Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { Avatar } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { AvatarTile } from "../profile/avatar.tsx";
import { ReadFailure } from "../ui/read-failure.tsx";
import { listView } from "./coordinator-groups.ts";

export function CoordinatorList({ ref, onOpen }: { ref: Ref<HTMLDivElement>; onOpen(id: CoordinatorId): void }) {
  const read = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  const live = useSidebarThreads();
  const navigate = useBbNavigate();
  const view = listView(read, live);

  return (
    // why the tab stop: the list scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the list: {read.error.message}</ReadFailure>}
        {live.status === "error" && <ReadFailure>Could not read bb's threads.</ReadFailure>}
        {view.kind === "empty" && <Empty />}
        {view.kind === "listed" && (
          <>
            {view.notStarted.length > 0 && (
              <Section id="not-started" title="Not started">
                {view.notStarted.map(({ id, name, description, avatar }) => (
                  <Row key={id} name={name} description={description} avatar={avatar} onOpen={() => onOpen(id)} />
                ))}
              </Section>
            )}
            {view.groups.map((group) => (
              <Section key={group.project.id} id={`project-${group.project.id}`} title={group.project.name}>
                {group.rows.map(({ coordinator, thread }) => (
                  <Row key={coordinator.id} name={thread.displayTitle} description={coordinator.description} avatar={coordinator.avatar} onOpen={() => navigate.toThread(thread.id)} />
                ))}
              </Section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2 id={id} className="px-2 text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

type RowProps = { name: string; description: string | null; avatar: Avatar; onOpen(): void };

/** A regional manager by its avatar, its name and its description below it. */
function Row({ name, description, avatar, onOpen }: RowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <AvatarTile avatar={avatar} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{name}</span>
          {description !== null && <span className="truncate text-xs text-muted-foreground">{description}</span>}
        </span>
      </button>
    </li>
  );
}

// why no button here: New sits in the panel's title bar, one primary action per screen.
function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <Icon name="Workflow" className="size-6 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No regional managers yet</p>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">Press New and name one, then give it a goal. It plans the work and keeps its memory in files.</p>
      </div>
    </div>
  );
}
