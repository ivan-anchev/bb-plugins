// The Changes tab's header (ported from code-explorer's changes-header, without its target picker):
// the summary, then search, Filter, collapse or expand all and the diff settings, and the path
// filter under them while it is open. It stays mounted while the diff loads, with a placeholder
// summary over an empty tree. The row wraps, so the controls drop under a long summary in a narrow
// pane rather than out of it.
import { useRef } from "react";
import type { FileTree as TreeModel } from "@pierre/trees";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ChangeKind } from "../../../guide/change-kind.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import type { ChangesControls } from "../use-changes-controls.ts";
import { CollapseAllButton } from "./collapse-all-button.tsx";
import { FilterMenu, SettingsMenu } from "./header-menus.tsx";
import { SummaryText, type SummaryState } from "./summary-text.tsx";

type ChangesHeaderProps = {
  controls: ChangesControls;
  summary: SummaryState;
  extensionCounts: readonly [string, number][];
  kindCounts: readonly [ChangeKind, number][];
  model: TreeModel;
};

export function ChangesHeader({ controls, summary, extensionCounts, kindCounts, model }: ChangesHeaderProps) {
  const { pathQuery } = controls;
  const search = useRef<HTMLButtonElement>(null);
  // Escape closes the filter and hands focus back to the button that opened it, never to the page.
  const closeFilter = () => {
    pathQuery.onChange(null);
    search.current?.focus();
  };
  return (
    <div className="shrink-0 select-none px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <SummaryText summary={summary} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton
            ref={search}
            icon="Search"
            label={pathQuery.value === null ? "Search filenames" : "Close filename search"}
            aria-pressed={pathQuery.value !== null}
            onClick={() => pathQuery.onChange(pathQuery.value === null ? "" : null)}
          />
          <FilterMenu
            filters={controls.filters}
            pathQuery={pathQuery}
            extensionCounts={extensionCounts}
            kindCounts={kindCounts}
          />
          <CollapseAllButton model={model} />
          <SettingsMenu settings={controls.settings} />
        </div>
      </div>
      {pathQuery.value === null ? null : <PathFilterInput value={pathQuery.value} onChange={pathQuery.onChange} onClose={closeFilter} />}
    </div>
  );
}

type PathFilterInputProps = { value: string; onChange(value: string): void; onClose(): void };

function PathFilterInput({ value, onChange, onClose }: PathFilterInputProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="relative mt-2">
      <span className="pointer-events-none absolute inset-y-0 left-2.25 flex w-8 items-center justify-center text-muted-foreground">
        <Icon name="Filter" className="size-3.5" aria-hidden />
      </span>
      <input
        ref={input}
        autoFocus
        aria-label="Filter changed files by path"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        placeholder={"Filter files, e.g. *.md, docs\u002f**, !*.test.ts"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
        className="flex h-8 w-full select-text rounded-lg border border-border bg-transparent py-1 pl-12 pr-8 text-xs transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {value === "" ? null : (
        <button
          type="button"
          aria-label="Clear file filter"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="X" className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
