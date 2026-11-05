import type { CodeOverflowMode, DiffViewMode } from "@get-bb/plugin-sdk/app";
import type { ChangesInput, WorkspaceStatus } from "../git.ts";
import { useRememberedState } from "../hooks/use-remembered-state.ts";
import {
  DEFAULT_TARGET,
  changeTargetOf,
  offeredTargetOf,
  targetOptionsOf,
  type TargetChoice,
  type TargetOption,
} from "./change-targets.ts";
import { NO_FILTERS, type FileFilters } from "./file-filter.ts";

export type DiffSettings = { view: DiffViewMode; overflow: CodeOverflowMode; ignoreWhitespace: boolean };

type Controlled<Value> = { value: Value; onChange(value: Value): void };

export type ChangesControls = {
  target: { options: readonly TargetOption[]; shown: TargetOption; onChange(choice: TargetChoice): void };
  pathQuery: Controlled<string | null>;
  filters: Controlled<FileFilters>;
  settings: Controlled<DiffSettings>;
};

const DEFAULT_SETTINGS: DiffSettings = { view: "unified", overflow: "scroll", ignoreWhitespace: false };

const rememberedTargets = new Map<string, TargetChoice>();
const rememberedPathQueries = new Map<string, string | null>();
const rememberedFilters = new Map<string, FileFilters>();
const rememberedSettings = new Map<string, DiffSettings>();

export function useChangesControls(environmentId: string, workspace: WorkspaceStatus) {
  const [choice, setChoice] = useRememberedState(rememberedTargets, environmentId, DEFAULT_TARGET);
  const [pathQuery, setPathQuery] = useRememberedState(rememberedPathQueries, environmentId, null);
  const [filters, setFilters] = useRememberedState(rememberedFilters, environmentId, NO_FILTERS);
  const [settings, setSettings] = useRememberedState(rememberedSettings, "diff", DEFAULT_SETTINGS);
  const options = targetOptionsOf(workspace);
  const shown = offeredTargetOf(choice, options);

  const controls: ChangesControls = {
    target: { options, shown, onChange: setChoice },
    pathQuery: { value: pathQuery, onChange: setPathQuery },
    filters: { value: filters, onChange: setFilters },
    settings: { value: settings, onChange: setSettings },
  };
  const input: ChangesInput = {
    environmentId,
    target: changeTargetOf(shown.choice, workspace),
    ignoreWhitespace: settings.ignoreWhitespace,
  };
  return { controls, input };
}
