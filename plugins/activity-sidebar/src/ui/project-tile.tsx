// A project's tile: its initial on its hue (Zeron's project_default), in a row and in the filter menu.
import { HUE_COLORS, type Hue } from "../model/project-hue.ts";

export function ProjectTile({ name, hue }: { name: string; hue: Hue }) {
  const { fill, ink } = HUE_COLORS[hue];
  return (
    <span className="as-tile" style={{ background: fill, color: ink }} aria-hidden>
      {(name.at(0) ?? "?").toUpperCase()}
    </span>
  );
}
