// The PR page's tabs under its header, Summary, Changes then Guide, on the ARIA tabs pattern: one
// tab stop, ← → Home End to move, and a tab is selected as it is focused. The bar stays put and each panel
// scrolls on its own. Every panel stays mounted, hidden while another is selected, so the guide
// keeps its step and scroll position across switches, and Changes its file, scroll and folders.
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { Spinner } from "../ui/spinner.tsx";

export type PrTab = "summary" | "changes" | "guide";

// `panelTabStop`: whether the panel itself takes the tab stop after the tab, for content that
// brings none of its own. Changes does: its file tree and its diff, or its read's region while the
// diff loads or after a failed read. Every Guide screen does too: its actions, or the guide's page
// region, which the guide renders while it loads and after a failed read too.
const TABS: { id: PrTab; label: string; panelTabStop: boolean }[] = [
  { id: "summary", label: "Summary", panelTabStop: true },
  { id: "changes", label: "Changes", panelTabStop: false },
  { id: "guide", label: "Guide", panelTabStop: false },
];

/** What a tab's label shows after its name: a dot once its content is ready, a spinner while it is written. */
export type TabStatus = "none" | "ready" | "writing";

/** A tab's panel, its status, and the controls it adds to the bar's end while it is selected. */
export type TabContent = { status: TabStatus; panel: ReactNode; barEnd: ReactNode };

type PrTabsProps = { selected: PrTab; onSelect(tab: PrTab): void; tabs: Record<PrTab, TabContent> };

export function PrTabs({ selected, onSelect, tabs }: PrTabsProps) {
  const ids = useTabIds();
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-[22px]">
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

// A panel tab stop (the hidden panel drops out of the tab order) means Tab from the selected tab
// lands on the panel, so a Summary with no links or overflow still has one. The panel is the scroll
// region for content that runs long, so the keys scroll it from that stop. Content with its own
// scroll region (the guide, pinning its controller) fills the panel and makes that region its tab
// stop instead: the keys scroll the focused element's region, never one inside it. The ring sits
// inside because the panel runs edge to edge.
const PANEL_CLASS =
  "flex min-h-0 flex-1 flex-col overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset";

type TabIds = { tab(id: PrTab): string; panel(id: PrTab): string };

// Unique per page: a split view can show two PR pages at once.
function useTabIds(): TabIds {
  const prefix = useId();
  return { tab: (id) => `${prefix}-tab-${id}`, panel: (id) => `${prefix}-panel-${id}` };
}

type TabListProps = PrTabsProps & { ids: TabIds };

function TabList({ selected, onSelect, tabs, ids }: TabListProps) {
  // The tab keeps focus and selects as it goes. Handling the key here also keeps it from the
  // guide's ← → step keys, which skip a key already handled.
  const onKeyDown = (event: KeyboardEvent) => {
    const to = tabAfterKey(event.key, selected);
    if (to === undefined) return;
    event.preventDefault();
    onSelect(to);
    document.getElementById(ids.tab(to))?.focus();
  };
  return (
    <div role="tablist" aria-label="Pull request" className="flex gap-0.5" onKeyDown={onKeyDown}>
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

const TAB_CLASS =
  "inline-flex h-7 cursor-pointer items-center gap-[7px] rounded-[7px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-selected:bg-state-active aria-selected:text-foreground motion-reduce:transition-none";

// → and ← wrap around; Home and End go to the first and the last tab. Undefined for any other key.
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

// The leading comma makes the tab read "Guide, ready" to a screen reader. The dot takes the
// theme's success text colour, as the header's passing checks do: `success` itself is too pale on
// light surfaces for a graphic that carries meaning (WCAG 1.4.11 asks 3:1).
function StatusMark({ status }: { status: TabStatus }) {
  switch (status) {
    case "none":
      return null;
    case "ready":
      return (
        <>
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success-foreground" />
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
    default:
      return status satisfies never;
  }
}
