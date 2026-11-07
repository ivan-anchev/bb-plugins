// The sidebar's project picker: bb projects with a GitHub remote, one per row with its repo.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { GitHubProject } from "../../contract.ts";
import { Menu, MenuCheck, MenuContent, MenuItem, MenuTrigger } from "../ui/menu.tsx";

type ProjectPickerProps = { projects: GitHubProject[]; value: string | null; onChange(projectId: string): void };

export function ProjectPicker({ projects, value, onChange }: ProjectPickerProps) {
  const selected = projects.find((project) => project.id === value);
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="Project"
          className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] font-medium transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-state-active"
        >
          <span className="truncate">{selected?.name ?? "Choose a project"}</span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {projects.map((project) => (
          <MenuItem key={project.id} onSelect={() => onChange(project.id)}>
            <span className="min-w-0">
              <span className="block truncate">{project.name}</span>
              <span className="block truncate text-muted-foreground">{project.repo}</span>
            </span>
            <MenuCheck shown={project.id === value} />
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
