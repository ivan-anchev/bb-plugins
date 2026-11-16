// A tab's projects as a fanned stack of tiles, one per thread pane: the front tile is the focused pane's
// project with its initial (Zeron's project_default), the ones behind only show their hue. The tile is
// copied from activity-sidebar's src/ui/project-tile.tsx, so this plugin installs on its own.
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import type { CSSProperties } from "react";
import { hueOf } from "./project-hue.ts";

export function ProjectStack({ projects }: { projects: Pick<PluginSidebarProject, "id" | "name">[] }) {
  if (projects.length === 0) return null;
  return (
    <span className="ht-stack" aria-hidden>
      {projects.map((project, i) => (
        // why the index key: one project can hold several cards, and nothing animates, so a card's identity doesn't matter.
        <span key={i} className="ht-tile" data-hue={hueOf(project.id)} style={depthStyle(i)}>
          {i === 0 ? (project.name.at(0) ?? "?").toUpperCase() : null}
        </span>
      ))}
    </span>
  );
}

/** The tile's place in the stack, 0 in front, which app.css turns into its rotation and stacking order. */
function depthStyle(depth: number): CSSProperties & Record<"--ht-depth", number> {
  return { "--ht-depth": depth };
}
