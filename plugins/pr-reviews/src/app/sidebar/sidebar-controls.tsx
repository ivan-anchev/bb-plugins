// The sidebar's pane header: the section chips, then the Filter, Activity's view button, a quiet
// icon lit while it hides a section. The Filter opens a menu that shows and hides each section.
// The bar is a `pr-pane-header`, bb's pane header, so it lines up with the PR pane's across the split.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ReactNode, Ref } from "react";
import type { Section, SectionKey } from "../../contract.ts";
import { Menu, MenuCheckboxItem, MenuContent, MenuCountedLabel, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { withSection } from "./section-filter.ts";
import { SECTION_TEXT } from "./section-text.ts";

type SidebarHeaderProps = {
  /** The bar's start: the section chips. */
  children: ReactNode;
  sections: readonly Section[];
  hidden: readonly SectionKey[];
  onHiddenChange(hidden: SectionKey[]): void;
  filterButton: Ref<HTMLButtonElement>;
};

export function SidebarHeader({ children, ...filter }: SidebarHeaderProps) {
  return (
    <div className="pr-pane-header gap-1 pr-1.5 pl-2">
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      <SectionFilter {...filter} />
    </div>
  );
}

// Activity's `.as-filter`; its icon's right edge lines up with the rows' badges.
const FILTER =
  "mr-0.75 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none data-on:text-foreground data-[state=open]:bg-state-hover data-[state=open]:text-foreground";

function SectionFilter({ sections, hidden, onHiddenChange, filterButton }: Omit<SidebarHeaderProps, "children">) {
  const filtering = hidden.length > 0;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          ref={filterButton}
          type="button"
          aria-label={filtering ? "Filter sections, some hidden" : "Filter sections"}
          data-on={filtering || undefined}
          className={FILTER}
        >
          <Icon name="FilterHorizontal" className="size-3.5" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-48">
        <MenuLabel>Show sections</MenuLabel>
        {sections.map(({ key, count }) => (
          <MenuCheckboxItem key={key} keepOpen checked={!hidden.includes(key)} onCheckedChange={(shown) => onHiddenChange(withSection(hidden, key, !shown))}>
            <MenuCountedLabel label={SECTION_TEXT[key].title} count={count} />
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuItem disabled={!filtering} onSelect={() => onHiddenChange([])}>
          Show all sections
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
