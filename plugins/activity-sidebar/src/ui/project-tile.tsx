import type { Hue } from "../model/project-hue.ts";

export function ProjectTile({ name, hue }: { name: string; hue: Hue }) {
  return (
    <span className="as-tile" data-hue={hue} aria-hidden>
      {(name.at(0) ?? "?").toUpperCase()}
    </span>
  );
}
