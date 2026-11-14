// The button at the end of Activity's title: the list's view (the prototype's ⋯ menu, P:952-978). Compact
// first, a line a row or two; then the project every section is narrowed to, or all of them.
// bb's host shims Radix, so this menu shares its overlay layer (focus, dismiss, stacking).
import { experimental_Icon as Icon, type PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { CheckboxItem, Content, ItemIndicator, Portal, RadioGroup, RadioItem, Root, Separator, Trigger } from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { hueOf } from "../model/project-hue.ts";
import { PORTAL_SCOPE } from "./portal-scope.ts";
import { ProjectTile } from "./project-tile.tsx";

const ALL = "";

type Props = {
  projects: readonly PluginSidebarProject[];
  chosen: PluginSidebarProject | null;
  onChoose(projectId: string | null): void;
  compact: boolean;
  onCompact(compact: boolean): void;
};

export function ViewMenu({ projects, chosen, onChoose, compact, onCompact }: Props) {
  return (
    <Root>
      <Trigger className="as-filter" aria-label={chosen === null ? "View options" : `View options, filtered to ${chosen.name}`} data-on={chosen !== null || undefined}>
        <Icon name="FilterHorizontal" aria-hidden />
      </Trigger>
      <Portal>
        <Content {...PORTAL_SCOPE} className="as-menu border" align="end" sideOffset={4} collisionPadding={8}>
          {/* why: a switch keeps the menu open, as the prototype's does, so the list changes beside it. */}
          <CheckboxItem className="as-menu-item" checked={compact} onCheckedChange={onCompact} onSelect={(e) => e.preventDefault()}>
            <span className="as-menu-label">Compact</span>
            <span className="as-switch" data-on={compact || undefined} aria-hidden />
          </CheckboxItem>
          <Separator className="as-menu-separator" />
          <RadioGroup value={chosen?.id ?? ALL} onValueChange={(value) => onChoose(value === ALL ? null : value)}>
            <Choice value={ALL} lead={<Icon name="Folder" className="as-menu-icon" aria-hidden />}>
              All projects
            </Choice>
            {projects.map((p) => (
              <Choice key={p.id} value={p.id} lead={<ProjectTile name={p.name} hue={hueOf(p.id)} />}>
                {p.name}
              </Choice>
            ))}
          </RadioGroup>
        </Content>
      </Portal>
    </Root>
  );
}

// ------------------------------------------------------------------ layer 2

function Choice({ value, lead, children }: { value: string; lead: ReactNode; children: ReactNode }) {
  return (
    <RadioItem value={value} className="as-menu-item">
      {lead}
      <span className="as-menu-label">{children}</span>
      <ItemIndicator className="as-menu-check">
        <Icon name="Check" aria-hidden />
      </ItemIndicator>
    </RadioItem>
  );
}
