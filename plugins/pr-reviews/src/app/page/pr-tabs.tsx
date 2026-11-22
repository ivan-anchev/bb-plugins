import { useId, type KeyboardEvent, type ReactNode } from "react";
import type { LineCounts } from "../../diff/diff-schema.ts";
import { labelStatPartsOf } from "../changes/change-stats.ts";
import { StatText } from "../changes/stat-text.tsx";
import { Spinner } from "../ui/spinner.tsx";

export type PrTab = "summary" | "changes" | "guide";

const TABS: { id: PrTab; label: string; panelTabStop: boolean }[] = [
  { id: "summary", label: "Summary", panelTabStop: true },
  { id: "changes", label: "Changes", panelTabStop: false },
  { id: "guide", label: "Guide", panelTabStop: false },
];

/** What a tab's label shows after its name: a dot once its content is ready, a spinner while it is
 *  written, or the lines a change adds and removes. */
type TabStatus = { kind: "none" } | { kind: "ready" } | { kind: "writing" } | ({ kind: "lines" } & LineCounts);

/** A tab's panel, its status, and the controls it adds to the bar's end while it is selected. */
export type TabContent = { status: TabStatus; panel: ReactNode; barEnd: ReactNode };

type PrTabsProps = { selected: PrTab; onSelect(tab: PrTab): void; tabs: Record<PrTab, TabContent> };

export function PrTabs({ selected, onSelect, tabs }: PrTabsProps) {
  const ids = useTabIds();
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 px-6">
        <TabList selected={selected} onSelect={onSelect} tabs={tabs} ids={ids} />
        <div className="ml-auto flex items-center">{tabs[selected].barEnd}</div>
      </div>
      {TABS.map(({ id, panelTabStop }) => (
        <div
          key={id}
          role="tabpanel"
          id={ids.panel(id)}
          aria-labelledby={ids.tab(id)}
          hidden={id !== selected}
          tabIndex={panelTabStop ? 0 : undefined}
          className={PANEL_CLASS}
        >
          {tabs[id].panel}
        </div>
      ))}
    </>
  );
}

const PANEL_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset";

type TabIds = { tab(id: PrTab): string; panel(id: PrTab): string };

function useTabIds(): TabIds {
  const prefix = useId();
  return { tab: (id) => `${prefix}-tab-${id}`, panel: (id) => `${prefix}-panel-${id}` };
}

type TabListProps = PrTabsProps & { ids: TabIds };

function TabList({ selected, onSelect, tabs, ids }: TabListProps) {
  const onKeyDown = (event: KeyboardEvent) => {
    const to = tabAfterKey(event.key, selected);
    if (to === undefined) return;
    event.preventDefault();
    onSelect(to);
    document.getElementById(ids.tab(to))?.focus();
  };
  return (
    <div role="tablist" aria-label="Pull request" className={TAB_LIST_CLASS} onKeyDown={onKeyDown}>
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={ids.tab(id)}
          aria-controls={ids.panel(id)}
          aria-selected={id === selected}
          tabIndex={id === selected ? 0 : -1}
          onClick={() => onSelect(id)}
          className={TAB_CLASS}
        >
          {label}
          <StatusMark status={tabs[id].status} />
        </button>
      ))}
    </div>
  );
}

const TAB_LIST_CLASS = "flex gap-0.5 rounded-lg bg-surface-recessed p-0.5";

const TAB_CLASS =
  "inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground hover:duration-0 focus-visible:outline-none aria-selected:bg-state-active aria-selected:text-foreground aria-selected:ring-1 aria-selected:ring-border-hairline aria-selected:focus-visible:ring-ring motion-reduce:transition-none";

function tabAfterKey(key: string, selected: PrTab): PrTab | undefined {
  const move = TAB_KEYS[key];
  if (move === undefined) return undefined;
  return TABS[move(TABS.findIndex((tab) => tab.id === selected), TABS.length - 1)]?.id;
}

const TAB_KEYS: Partial<Record<string, (at: number, last: number) => number>> = {
  ArrowRight: (at, last) => (at === last ? 0 : at + 1),
  ArrowLeft: (at, last) => (at === 0 ? last : at - 1),
  Home: () => 0,
  End: (_, last) => last,
};

function StatusMark({ status }: { status: TabStatus }) {
  switch (status.kind) {
    case "none":
      return null;
    case "ready":
      return (
        <>
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="sr-only">, ready</span>
        </>
      );
    case "writing":
      return (
        <>
          <Spinner size="small" />
          <span className="sr-only">, writing</span>
        </>
      );
    case "lines":
      return (
        <>
          <span aria-hidden className="tabular-nums">
            <StatText parts={labelStatPartsOf(status)} />
          </span>
          <span className="sr-only">
            , {countOf(status.added, "addition")}, {countOf(status.removed, "deletion")}
          </span>
        </>
      );
    default:
      return status satisfies never;
  }
}

const countOf = (count: number, noun: string) => `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
