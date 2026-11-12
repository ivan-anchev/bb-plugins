// The slim row above the sidebar's sections: a Filter menu that shows and hides each section. It
// scrolls with the list, so the sticky section headings stay as they are. The small, quiet button
// sits 3px in so its icon lines up with the rows' status icons.
import type { Ref } from "react";
import type { Section, SectionKey } from "../../contract.ts";
import { IconButton } from "../ui/icon-button.tsx";
import { Menu, MenuCheckboxItem, MenuContent, MenuCountedLabel, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { withSectionShown } from "./section-filter.ts";
import { SECTION_TEXT } from "./section-text.ts";

type SidebarControlsProps = {
  sections: readonly Section[];
  hidden: readonly SectionKey[];
  onChange(hidden: SectionKey[]): void;
  filterButton: Ref<HTMLButtonElement>;
};

export function SidebarControls({ sections, hidden, onChange, filterButton }: SidebarControlsProps) {
  const filtering = hidden.length > 0;
  return (
    <div className="flex justify-end pr-[3px]">
      <Menu>
        <MenuTrigger asChild>
          <IconButton ref={filterButton} icon="Filter" label="Filter sections" size="dismiss" aria-pressed={filtering} indicator={filtering} />
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
  );
}
