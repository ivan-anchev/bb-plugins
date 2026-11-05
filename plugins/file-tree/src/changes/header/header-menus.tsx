import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { IconButton } from "../../ui/icon-button.tsx";
import {
  Menu,
  MenuCheck,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/menu.tsx";
import type { TargetOption } from "../change-targets.ts";
import { NO_FILTERS, isFiltering, withExtensionShown, type FileFilters } from "../file-filter.ts";
import type { ChangesControls, DiffSettings } from "../use-changes-controls.ts";

export function TargetSelect({ target }: { target: ChangesControls["target"] }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-border bg-transparent px-2.5 text-xs transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <TargetLabel option={target.shown} />
          <Icon name="ChevronDown" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent
        align="start"
        className="min-w-(--radix-dropdown-menu-trigger-width) max-w-(--radix-popper-available-width)"
      >
        {target.options.map((option) => (
          <MenuItem key={option.key} onSelect={() => target.onChange(option.choice)}>
            <TargetLabel option={option} />
            <MenuCheck shown={option.key === target.shown.key} />
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function TargetLabel({ option }: { option: TargetOption }) {
  return (
    <span
      title={option.monoPrefix === null ? option.label : `${option.monoPrefix} ${option.label}`}
      className="flex min-w-0 items-baseline gap-2"
    >
      {option.monoPrefix === null ? null : (
        <span className="shrink-0 font-mono text-muted-foreground">{option.monoPrefix}</span>
      )}
      <span className="truncate">{option.label}</span>
    </span>
  );
}

type FilterMenuProps = {
  filters: ChangesControls["filters"];
  pathQuery: ChangesControls["pathQuery"];
  extensionCounts: readonly [string, number][];
};

export function FilterMenu({ filters, pathQuery, extensionCounts }: FilterMenuProps) {
  const active = isFiltering(pathQuery.value, filters.value);
  const change = (next: Partial<FileFilters>) => filters.onChange({ ...filters.value, ...next });
  const reset = () => {
    filters.onChange(NO_FILTERS);
    pathQuery.onChange(pathQuery.value === null ? null : "");
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton icon="Filter" label="Filter files" aria-pressed={active} indicator={active} />
      </MenuTrigger>
      <MenuContent align="end" className="max-h-80 min-w-48 overflow-y-auto">
        <MenuLabel>File extensions</MenuLabel>
        <MenuCheckboxItem keepOpen checked={filters.value.extensions.length === 0} onCheckedChange={() => change({ extensions: [] })}>
          All types
        </MenuCheckboxItem>
        {extensionCounts.map(([extension, count]) => (
          <MenuCheckboxItem
            key={extension}
            keepOpen
            checked={filters.value.extensions.includes(extension)}
            onCheckedChange={(shown) => filters.onChange(withExtensionShown(filters.value, extension, shown))}
          >
            <span className="flex w-full items-center justify-between gap-6">
              <span>{extension === "" ? "No extension" : extension}</span>
              <span className="rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums">{count}</span>
            </span>
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuCheckboxItem keepOpen checked={filters.value.showDeleted} onCheckedChange={(showDeleted) => change({ showDeleted })}>
          Deleted files
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuItem disabled={!active} onSelect={reset}>
          Reset filters
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function SettingsMenu({ settings }: { settings: ChangesControls["settings"] }) {
  const { value } = settings;
  const change = (next: Partial<DiffSettings>) => settings.onChange({ ...value, ...next });

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton icon="Settings" label="Diff settings" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuCheckboxItem checked={value.view === "unified"} onCheckedChange={() => change({ view: "unified" })}>
          Unified
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={value.view === "split"} onCheckedChange={() => change({ view: "split" })}>
          Split
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={value.overflow === "wrap"}
          onCheckedChange={(wrap) => change({ overflow: wrap ? "wrap" : "scroll" })}
        >
          Wrap lines
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={value.ignoreWhitespace}
          onCheckedChange={(ignoreWhitespace) => change({ ignoreWhitespace })}
        >
          Hide whitespace
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}
