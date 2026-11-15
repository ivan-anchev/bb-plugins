// A project's tile: its initial on its hue (Zeron's project_default). Copied from activity-sidebar's
// src/ui/project-tile.tsx, so this plugin installs on its own.
import type { Hue } from "./project-hue.ts";

export function ProjectTile({ name, hue }: { name: string; hue: Hue }) {
  return (
    <span className="ht-tile" data-hue={hue} aria-hidden>
      {(name.at(0) ?? "?").toUpperCase()}
    </span>
  );
}
