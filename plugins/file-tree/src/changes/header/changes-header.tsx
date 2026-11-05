import { useRef } from "react";
import type { FileTree as TreeModel } from "@pierre/trees";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { IconButton } from "../../ui/icon-button.tsx";
import { lineStatPartsOf, type ChangeSummary, type StatPart } from "../change-stats.ts";
import type { ChangesControls } from "../use-changes-controls.ts";
import { CollapseAllButton, DisabledCollapseButton } from "./collapse-all-button.tsx";
import { FilterMenu, SettingsMenu, TargetSelect } from "./header-menus.tsx";

type ChangesHeaderProps = {
  controls: ChangesControls;
  summary: ChangeSummary | null;
  extensionCounts: readonly [string, number][];
  model: TreeModel | null;
};

const TONE_CLASSES: Record<StatPart["tone"], string> = {
  added: "text-diff-added",
  removed: "text-diff-removed",
  muted: "text-muted-foreground",
};

export function ChangesHeader({ controls, summary, extensionCounts, model }: ChangesHeaderProps) {
  const { pathQuery } = controls;
  return (
    <div className="shrink-0 select-none px-4 pb-3 pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 basis-48 grow-[999]">
          <TargetSelect target={controls.target} />
        </div>
        <div className="flex min-w-0 flex-1 basis-auto flex-wrap items-center gap-x-3 gap-y-2">
          <SummaryText summary={summary} />
          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1">
            <IconButton
              icon="Search"
              label={pathQuery.value === null ? "Search filenames" : "Close filename search"}
              aria-pressed={pathQuery.value !== null}
              onClick={() => pathQuery.onChange(pathQuery.value === null ? "" : null)}
            />
            <FilterMenu filters={controls.filters} pathQuery={pathQuery} extensionCounts={extensionCounts} />
            {model === null ? <DisabledCollapseButton /> : <CollapseAllButton model={model} />}
            <SettingsMenu settings={controls.settings} />
          </div>
        </div>
      </div>
      {pathQuery.value === null ? null : <PathFilterInput value={pathQuery.value} onChange={pathQuery.onChange} />}
    </div>
  );
}

function SummaryText({ summary }: { summary: ChangeSummary | null }) {
  if (summary === null) {
    return (
      <span
        role="status"
        aria-label="Loading changes"
        className="inline-block h-3 w-24 animate-pulse rounded-sm bg-surface-selected align-middle"
      />
    );
  }
  return (
    <span title={summary.title} className="min-w-0 max-w-full shrink-0 truncate pl-2.5 text-xs text-muted-foreground">
      {summary.text}
      {summary.stats === null ? null : <StatText parts={lineStatPartsOf(summary.stats)} />}
    </span>
  );
}

function StatText({ parts }: { parts: readonly StatPart[] }) {
  return (
    <span className="whitespace-nowrap">
      {parts.map((part, index) => (
        <span key={part.tone}>
          {index === 0 ? null : " "}
          <span className={TONE_CLASSES[part.tone]}>{part.text}</span>
        </span>
      ))}
    </span>
  );
}

function PathFilterInput({ value, onChange }: { value: string; onChange(value: string | null): void }) {
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
          onChange(null);
        }}
        className="flex h-8 w-full select-text rounded-lg border border-border bg-transparent py-1 pl-12 pr-8 text-xs transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none"
      />
      {value === "" ? null : (
        <button
          type="button"
          aria-label="Clear file filter"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground hover:text-foreground"
        >
          <Icon name="X" className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
