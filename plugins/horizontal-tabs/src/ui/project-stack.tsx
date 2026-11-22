import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import type { CSSProperties } from "react";
import { hueOf } from "./project-hue.ts";

export function ProjectStack({ projects }: { projects: Pick<PluginSidebarProject, "id" | "name">[] }) {
  if (projects.length === 0) return null;
  return (
    <span className="ht-stack" aria-hidden>
      {projects.map((project, i) => (
        <span key={i} className="ht-tile" data-hue={hueOf(project.id)} style={depthStyle(i)}>
          {i === 0 ? (project.name.at(0) ?? "?").toUpperCase() : null}
        </span>
      ))}
    </span>
  );
}

function depthStyle(depth: number): CSSProperties & Record<"--ht-depth", number> {
  return { "--ht-depth": depth };
}
