// The button at the end of Activity's title: narrows every section to one project, or shows them all.
// bb's host shims Radix, so this menu shares its overlay layer (focus, dismiss, stacking).
import { experimental_Icon as Icon, type PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { Content, ItemIndicator, Portal, RadioGroup, RadioItem, Root, Separator, Trigger } from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { hueOf } from "../model/project-hue.ts";
import { ProjectTile } from "./project-tile.tsx";

declare const __BB_PLUGIN_ID__: string;
// The attributes bb's overlay layer expects on a plugin's portaled overlay.
const PORTAL_SCOPE = { "data-bb-portaled-overlay": "", "data-bb-plugin-root": "", "data-bb-plugin": __BB_PLUGIN_ID__ };

const ALL = "";

type Props = { projects: readonly PluginSidebarProject[]; chosen: PluginSidebarProject | null; onChoose(projectId: string | null): void };

export function ProjectFilter({ projects, chosen, onChoose }: Props) {
  return (
    <Root>
      <Trigger className="as-filter" aria-label={chosen === null ? "Filter by project" : `Filtered to ${chosen.name}`} data-on={chosen !== null || undefined}>
        <Icon name="FilterHorizontal" aria-hidden />
      </Trigger>
      <Portal>
        <Content {...PORTAL_SCOPE} className="as-menu border" align="end" sideOffset={4} collisionPadding={8}>
          <RadioGroup value={chosen?.id ?? ALL} onValueChange={(value) => onChoose(value === ALL ? null : value)}>
            <Choice value={ALL} lead={<Icon name="Folder" className="as-menu-icon" aria-hidden />}>
              All projects
            </Choice>
            <Separator className="as-menu-separator" />
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
