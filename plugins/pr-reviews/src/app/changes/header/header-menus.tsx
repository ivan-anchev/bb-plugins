// The Changes header's menus (ported from code-explorer's header-menus): Filter (kinds, extensions,
// deleted files, reset) and diff settings (Unified or Split, Wrap lines).
import { CHANGE_KIND_LABELS, TEST_KINDS, type ChangeKind } from "../../../guide/change-kind.ts";
import type { DiffSettings } from "../../diff/diff-options.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../../ui/menu.tsx";
import { NO_FILTERS, hidesKinds, isFiltering, withExtensionShown, withKindsShown, type FileFilters } from "../file-filter.ts";
import type { ChangesControls } from "../use-changes-controls.ts";

type FilterMenuProps = {
  filters: ChangesControls["filters"];
  pathQuery: ChangesControls["pathQuery"];
  extensionCounts: readonly [string, number][];
  kindCounts: readonly [ChangeKind, number][];
};

export function FilterMenu({ filters, pathQuery, extensionCounts, kindCounts }: FilterMenuProps) {
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
        <KindFilters filters={filters} kindCounts={kindCounts} />
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
            <CountedLabel label={extension === "" ? "No extension" : extension} count={count} />
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

type KindFiltersProps = { filters: ChangesControls["filters"]; kindCounts: readonly [ChangeKind, number][] };

function KindFilters({ filters, kindCounts }: KindFiltersProps) {
  const showKinds = (kinds: readonly ChangeKind[], shown: boolean) =>
    filters.onChange(withKindsShown(filters.value, kinds, shown));
  const hasTests = kindCounts.some(([kind]) => TEST_KINDS.includes(kind));
  if (kindCounts.length === 0) return null;

  return (
    <>
      {hasTests ? (
        <>
          <MenuCheckboxItem
            keepOpen
            checked={hidesKinds(filters.value, TEST_KINDS)}
            onCheckedChange={(hide) => showKinds(TEST_KINDS, !hide)}
          >
            Hide tests
          </MenuCheckboxItem>
          <MenuSeparator />
        </>
      ) : null}
      <MenuLabel>Kinds</MenuLabel>
      {kindCounts.map(([kind, count]) => (
        <MenuCheckboxItem
          key={kind}
          keepOpen
          checked={!hidesKinds(filters.value, [kind])}
          onCheckedChange={(shown) => showKinds([kind], shown)}
        >
          <CountedLabel label={CHANGE_KIND_LABELS[kind]} count={count} />
        </MenuCheckboxItem>
      ))}
      <MenuSeparator />
    </>
  );
}

function CountedLabel({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex w-full items-center justify-between gap-6">
      <span>{label}</span>
      <span className="rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums">{count}</span>
    </span>
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
      </MenuContent>
    </Menu>
  );
}
