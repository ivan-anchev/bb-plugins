// The sidebar's Filter, Activity's view button: a quiet icon at the end of the top section title,
// lit while it hides a section. It opens a menu that shows and hides each section. It is pinned
// over the top title row, not inside one, so hiding the first section leaves it, and its open menu,
// in place.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Ref } from "react";
import type { Section, SectionKey } from "../../contract.ts";
import { Menu, MenuCheckboxItem, MenuContent, MenuCountedLabel, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { withSectionShown } from "./section-filter.ts";
import { SECTION_TEXT } from "./section-text.ts";

type SidebarControlsProps = {
  sections: readonly Section[];
  hidden: readonly SectionKey[];
  onChange(hidden: SectionKey[]): void;
  filterButton: Ref<HTMLButtonElement>;
};

// Activity's `.as-filter`; its icon's right edge lines up with the rows' badges.
const FILTER =
  "mr-0.75 flex size-6 cursor-pointer items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none data-on:text-foreground data-[state=open]:bg-state-hover data-[state=open]:text-foreground";

export function SidebarControls({ sections, hidden, onChange, filterButton }: SidebarControlsProps) {
  const filtering = hidden.length > 0;
  return (
    <div className="sticky top-0 z-20 h-0">
      <div className="flex h-6 items-center justify-end">
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
              <MenuCheckboxItem key={key} keepOpen checked={!hidden.includes(key)} onCheckedChange={(shown) => onChange(withSectionShown(hidden, key, shown))}>
                <MenuCountedLabel label={SECTION_TEXT[key].title} count={count} />
              </MenuCheckboxItem>
            ))}
            <MenuSeparator />
            <MenuItem disabled={!filtering} onSelect={() => onChange([])}>
              Show all sections
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}
