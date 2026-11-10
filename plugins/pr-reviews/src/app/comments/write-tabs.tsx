// The comment box's Write and Preview tabs, on the ARIA tabs pattern like the PR page's own tabs
// (page/pr-tabs.tsx), at a smaller size: one tab stop, ← → Home End to move, and a tab is
// selected as it is focused.
import { useId, useState, type KeyboardEvent } from "react";

export type Tab = "write" | "preview";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "write", label: "Write" },
  { id: "preview", label: "Preview" },
];

/** The selected tab, and the ids that tie each tab to its panel. */
export function useWriteTabs() {
  const [tab, setTab] = useState<Tab>("write");
  const prefix = useId();
  const ids = (of: Tab) => ({ tab: `${prefix}-${of}-tab`, panel: `${prefix}-${of}-panel` });
  return {
    tab,
    setTab,
    ids,
    /** The props of a tab's panel, the element that is shown while the tab is selected. */
    panelProps: (of: Tab) => ({ role: "tabpanel", id: ids(of).panel, "aria-labelledby": ids(of).tab }),
  };
}

type WriteTabsProps = {
  tabs: ReturnType<typeof useWriteTabs>;
  /** Write was clicked: its textarea takes focus, as a composer's does. */
  onWrite(): void;
};

const TAB_CLASS =
  "inline-flex h-6 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-selected:bg-state-active aria-selected:text-foreground motion-reduce:transition-none";

export function WriteTabs({ tabs, onWrite }: WriteTabsProps) {
  const select = (to: Tab) => {
    tabs.setTab(to);
    document.getElementById(tabs.ids(to).tab)?.focus();
  };
  // The tab keeps focus and selects as it goes. Handled here, the keys stay out of the diff's.
  const onKeyDown = (event: KeyboardEvent) => {
    const to = TAB_KEYS[event.key]?.(tabs.tab);
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    select(to);
  };
  return (
    <div role="tablist" aria-label="Write or preview" className="flex gap-0.5" onKeyDown={onKeyDown}>
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={tabs.ids(id).tab}
          aria-controls={tabs.ids(id).panel}
          aria-selected={id === tabs.tab}
          tabIndex={id === tabs.tab ? 0 : -1}
          onClick={() => {
            tabs.setTab(id);
            if (id === "write") onWrite();
          }}
          className={TAB_CLASS}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Two tabs: ← and → both go to the other one; Home and End to the first and the last.
const other = (tab: Tab): Tab => (tab === "write" ? "preview" : "write");
const TAB_KEYS: Partial<Record<string, (tab: Tab) => Tab>> = {
  ArrowRight: other,
  ArrowLeft: other,
  Home: () => "write",
  End: () => "preview",
};
