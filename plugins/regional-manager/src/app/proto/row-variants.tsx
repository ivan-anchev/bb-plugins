// PROTOTYPE (i7), throwaway: three directions for a threadless manager's row beside running ones.
//   Glyph   – one list, newest first; a threadless row says so by a dotted ring where a running
//             row has bb's status glyph, and has no Board or Memory.
//   Section – Activity Sidebar's rows under its quiet section titles: Not started first, then
//             each project. The section says it; the row carries no mark.
//   Start   – one list; a threadless row carries its next step, Set goal, where a running row
//             has Board and Memory.
import { experimental_Icon as Icon, experimental_ThreadStatusGlyph as ThreadStatusGlyph } from "@get-bb/plugin-sdk/app";
import { Button } from "../ui/button.tsx";
import { MANAGERS, type MockManager } from "./mock.ts";
import { AvatarIcon, NotStartedGlyph, PageShell } from "./parts.tsx";

type ListProps = { onOpen(manager: MockManager): void };

export const ROW_VARIANTS = [
  { name: "Glyph", render: (props: ListProps) => <PageShell><MarkedList {...props} /></PageShell> },
  { name: "Section", render: (props: ListProps) => <PageShell><SectionList {...props} /></PageShell> },
  { name: "Start", render: (props: ListProps) => <PageShell><StartList {...props} /></PageShell> },
] as const;

function ProjectTile({ project }: { project: { name: string; hue: string } }) {
  return (
    <span className="rmp-tile" data-hue={project.hue} title={project.name} aria-hidden>
      {project.name.at(0)?.toUpperCase()}
    </span>
  );
}

/** Today's row (coordinator-list.tsx): avatar tile, name and its glyph, description; the row opens it. */
function TodayRow({ manager, onOpen, signal, trailing }: { manager: MockManager; onOpen(): void; signal: "glyph" | "none"; trailing: React.ReactNode }) {
  const { profile, thread } = manager;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <AvatarIcon avatar={profile.avatar} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            {thread !== null && <ProjectTile project={thread.project} />}
            <span className="min-w-0 truncate font-medium">{profile.name}</span>
            <span className="flex size-4 shrink-0 items-center justify-center">
              {thread !== null ? <ThreadStatusGlyph indicator={thread.indicator} size="compact" /> : signal === "glyph" && <NotStartedGlyph />}
            </span>
          </span>
          {profile.description !== null && <span className="truncate text-xs text-muted-foreground">{profile.description}</span>}
        </span>
      </button>
      {trailing}
    </div>
  );
}

function BoardAndMemory({ name }: { name: string }) {
  return (
    <>
      <Button variant="ghost" size="sm" aria-label={`Board of ${name}`}>
        <Icon name="LayoutList" aria-hidden />
        <span className="max-sm:hidden">Board</span>
      </Button>
      <Button variant="ghost" size="sm" aria-label={`Memory of ${name}`}>
        <Icon name="FileText" aria-hidden />
        <span className="max-sm:hidden">Memory</span>
      </Button>
    </>
  );
}

// ------------------------------------------------------------------ Glyph

export function MarkedList({ onOpen }: ListProps) {
  return (
    <ul className="flex flex-col">
      {MANAGERS.map((manager) => (
        <li key={manager.id}>
          <TodayRow manager={manager} onOpen={() => onOpen(manager)} signal="glyph" trailing={manager.thread !== null && <BoardAndMemory name={manager.profile.name} />} />
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Section

function SectionList({ onOpen }: ListProps) {
  const threadless = MANAGERS.filter((manager) => manager.thread === null);
  const projects = [...new Set(MANAGERS.flatMap((manager) => (manager.thread === null ? [] : [manager.thread.project.name])))];
  return (
    <div className="rmp-list flex flex-col gap-2">
      <Section title="Not started" managers={threadless} onOpen={onOpen} />
      {projects.map((project) => (
        <Section key={project} title={project} managers={MANAGERS.filter((manager) => manager.thread?.project.name === project)} onOpen={onOpen} />
      ))}
    </div>
  );
}

function Section({ title, managers, onOpen }: { title: string; managers: readonly MockManager[]; onOpen(manager: MockManager): void }) {
  return (
    <section aria-label={title}>
      <h2 className="rmp-section">{title}</h2>
      <ul className="flex flex-col">
        {managers.map((manager) => (
          <li key={manager.id}>
            <ActivityRow manager={manager} onOpen={() => onOpen(manager)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Activity Sidebar's tall row: the avatar's glyph in the 30 slot, the name fading, the corner, the description under it. */
function ActivityRow({ manager, onOpen }: { manager: MockManager; onOpen(): void }) {
  const { profile, thread } = manager;
  return (
    <div className="rmp-rowbox group">
      <button type="button" className="rmp-row" data-compact={profile.description === null || undefined} onClick={onOpen}>
        <span className="rmp-slot">
          <span className="rmp-mark">
            <Icon name={profile.avatar.icon} />
          </span>
        </span>
        <span className="rmp-words">
          <span className="rmp-line">
            <span className="rmp-lead">
              <span className="rmp-title">{profile.name}</span>
            </span>
            {thread !== null && (
              <span className="rmp-corner">
                <ThreadStatusGlyph indicator={thread.indicator} size="compact" />
              </span>
            )}
          </span>
          {profile.description !== null && <span className="rmp-detail">{profile.description}</span>}
        </span>
      </button>
      {thread !== null && (
        // why shown on hover and focus only where something hovers: a touch screen keeps them in view.
        <span className="flex shrink-0 gap-0.5 pl-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <IconAction icon="LayoutList" label={`Board of ${profile.name}`} />
          <IconAction icon="FileText" label={`Memory of ${profile.name}`} />
        </span>
      )}
    </div>
  );
}

function IconAction({ icon, label }: { icon: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="relative flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 before:absolute before:-inset-1 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_[data-icon-root]]:size-3.5"
    >
      <Icon name={icon} aria-hidden />
    </button>
  );
}

// ------------------------------------------------------------------ Start

function StartList({ onOpen }: ListProps) {
  return (
    <ul className="flex flex-col">
      {MANAGERS.map((manager) => (
        <li key={manager.id}>
          <TodayRow
            manager={manager}
            onOpen={() => onOpen(manager)}
            signal="none"
            trailing={
              manager.thread !== null ? (
                <BoardAndMemory name={manager.profile.name} />
              ) : (
                <Button variant="secondary" size="sm" aria-label={`Set the goal of ${manager.profile.name}`} onClick={() => onOpen(manager)}>
                  <Icon name="Target" aria-hidden />
                  Set goal
                </Button>
              )
            }
          />
        </li>
      ))}
    </ul>
  );
}
