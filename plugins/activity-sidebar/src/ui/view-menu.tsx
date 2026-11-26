// A view's options: at the right end of the control row, or at the end of Activity's title while there
// is no row (no regional managers). Compact first, a line a row or two; then, when there are projects
// to choose from, the one the view is narrowed to, or all of them.
// bb's host shims Radix, so this menu shares its overlay layer (focus, dismiss, stacking).
import { experimental_Icon as Icon, type PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { CheckboxItem, Content, ItemIndicator, Portal, RadioGroup, RadioItem, Root, Separator, Trigger } from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { VIEW_NAMES, type View } from "../data/local-choice/choices.ts";
import { hueOf } from "../model/project-hue.ts";
import { PORTAL_SCOPE, useOverlayOpen } from "./portal-scope.ts";
import { ProjectTile } from "./project-tile.tsx";

const ALL = "";

type Props = {
  /** The view the options are for, which the button's name says. */
  view: View;
  /** The projects to narrow the view to; none, and there is no choice of project. */
  projects: readonly PluginSidebarProject[];
  chosen: PluginSidebarProject | null;
  onChoose(projectId: string | null): void;
  compact: boolean;
  onCompact(compact: boolean): void;
};

export function ViewMenu({ view, projects, chosen, onChoose, compact, onCompact }: Props) {
  const [open, setOpen] = useOverlayOpen();
  const name = `${VIEW_NAMES[view]} options`;
  return (
    <Root open={open} onOpenChange={setOpen}>
      <Trigger className="as-filter" aria-label={chosen === null ? name : `${name}, filtered to ${chosen.name}`} data-on={chosen !== null || undefined}>
        <Icon name="FilterHorizontal" aria-hidden />
      </Trigger>
      <Portal>
        <Content {...PORTAL_SCOPE} className="as-menu border" align="end" sideOffset={4} collisionPadding={8}>
          {/* why: a switch keeps the menu open, as the prototype's does, so the list changes beside it. */}
          <CheckboxItem className="as-menu-item" checked={compact} onCheckedChange={onCompact} onSelect={(e) => e.preventDefault()}>
            <span className="as-menu-label">Compact</span>
            <span className="as-switch" data-on={compact || undefined} aria-hidden />
          </CheckboxItem>
          {projects.length > 0 && (
            <>
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
            </>
          )}
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
