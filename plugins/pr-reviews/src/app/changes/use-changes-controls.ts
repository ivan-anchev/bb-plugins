// The Changes tab's header controls (ported from code-explorer's use-changes-controls), remembered
// for the session: the path query and the filters per PR, the diff settings for every PR.
import type { CodeOverflowMode, DiffViewMode } from "@get-bb/plugin-sdk/app";
import { useRememberedState } from "../use-remembered-state.ts";
import { NO_FILTERS, type FileFilters } from "./file-filter.ts";

export type DiffSettings = { view: DiffViewMode; overflow: CodeOverflowMode };

type Controlled<Value> = { value: Value; onChange(value: Value): void };

/** `pathQuery` is null while the path filter is closed. */
export type ChangesControls = {
  pathQuery: Controlled<string | null>;
  filters: Controlled<FileFilters>;
  settings: Controlled<DiffSettings>;
};

const DEFAULT_SETTINGS: DiffSettings = { view: "unified", overflow: "scroll" };

const rememberedPathQueries = new Map<string, string | null>();
const rememberedFilters = new Map<string, FileFilters>();
const rememberedSettings = new Map<string, DiffSettings>();

/** `memoryKey`: the PR the path query and filters belong to. */
export function useChangesControls(memoryKey: string): ChangesControls {
  const [pathQuery, setPathQuery] = useRememberedState(rememberedPathQueries, memoryKey, null);
  const [filters, setFilters] = useRememberedState(rememberedFilters, memoryKey, NO_FILTERS);
  const [settings, setSettings] = useRememberedState(rememberedSettings, "diff", DEFAULT_SETTINGS);
  return {
    pathQuery: { value: pathQuery, onChange: setPathQuery },
    filters: { value: filters, onChange: setFilters },
    settings: { value: settings, onChange: setSettings },
  };
}
