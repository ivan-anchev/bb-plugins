// experimental_sidebar: the project picker, then the chosen project's open PRs.
import { useEffect } from "react";
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { guideHeadShaOf, type GitHubProject, type PrRow } from "../../contract.ts";
import { useChangesToReread, useGuide, useProjects, usePullRequest, usePullRequests, useSelectProject, type GuideTarget } from "../queries.ts";
import { PANEL_PATH, parseRoute, routeSubPath, type Route } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { PrRowButton } from "./pr-row.tsx";
import { ProjectPicker } from "./project-picker.tsx";

export function PrSidebar({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  const projects = useProjects();
  const project = useChooseProject();
  useOpenRememberedProject(route, projects.data);
  const projectId = route.kind === "root" ? null : route.projectId;

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <div className="shrink-0 px-1.5 pt-2 pb-1">
        <ReadError read={projects} what="projects" />
        {projects.data?.unreadable.map(({ id, name, message }) => (
          <Notice key={id} tone="error">
            Could not read the git remote of {name}: {message}
          </Notice>
        ))}
        {project.error !== null && <Notice tone="error">Could not remember this project: {project.error.message}</Notice>}
        {projects.data?.projects.length === 0 && <Notice>No bb project has a GitHub remote.</Notice>}
        {projects.data !== undefined && projects.data.projects.length > 0 && (
          <ProjectChoice projects={projects.data.projects} projectId={projectId} choose={project.choose} />
        )}
      </div>
      {projectId !== null && <PrList key={projectId} projectId={projectId} openNumber={route.kind === "pr" ? route.number : null} />}
    </div>
  );
}

type ProjectChoiceProps = { projects: GitHubProject[]; projectId: string | null; choose(projectId: string): void };

function ProjectChoice({ projects, projectId, choose }: ProjectChoiceProps) {
  return projectId === null ? (
    <ProjectPicker projects={projects} value={null} onChange={choose} />
  ) : (
    <OpenProjectPicker projects={projects} projectId={projectId} choose={choose} />
  );
}

// Choosing the project that is already open re-reads its pull requests, so a failed list is
// retried (REVIEW.md); navigating to the route already shown would not. Same input as the
// list's read, so this refetches the list's cache entry.
function OpenProjectPicker({ projects, projectId, choose }: ProjectChoiceProps & { projectId: string }) {
  const pulls = usePullRequests(projectId);
  const onChange = (chosen: string) => {
    choose(chosen);
    if (chosen === projectId) void pulls.refetch();
  };
  return <ProjectPicker projects={projects} value={projectId} onChange={onChange} />;
}

function PrList({ projectId, openNumber }: { projectId: string; openNumber: number | null }) {
  const pulls = usePullRequests(projectId);
  const navigate = useBbNavigate();
  const openPr = (number: number) => navigate.toPluginPanel(PANEL_PATH, { subPath: routeSubPath({ kind: "pr", projectId, number }) });
  const rows = pulls.data?.rows;

  return (
    <>
      <ReadError read={pulls} what="pull requests" />
      {pulls.isLoading && <Notice>Loading pull requests…</Notice>}
      {rows?.length === 0 && <Notice>No open pull requests in {pulls.data?.repo}.</Notice>}
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {rows?.map((row) => (
          <li key={row.number}>
            {row.number === openNumber ? (
              <OpenPrRow projectId={projectId} row={row} refetchList={pulls.refetch} />
            ) : (
              <PrRowButton row={row} current={false} onClick={() => openPr(row.number)} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

// Clicking the open PR again re-reads it, its diff once read, its guide and the list, so a failed
// read is retried (REVIEW.md); navigating to the route already shown would not. Same inputs as the
// page's reads, so this refetches the page's cache entries.
type OpenPrRowProps = { projectId: string; row: PrRow; refetchList(): Promise<void> };

function OpenPrRow({ projectId, row, refetchList }: OpenPrRowProps) {
  const pull = usePullRequest(projectId, row.number);
  const headSha = pull.data === undefined ? null : guideHeadShaOf(pull.data.review);
  const changes = useChangesToReread({ projectId, number: row.number });
  const refetch = [pull.refetch, refetchList, ...changes.map((read) => read.refetch)];
  return headSha === null ? (
    <PrRowButton row={row} current onClick={() => void Promise.all(refetch.map((read) => read()))} />
  ) : (
    <OpenGuidedPrRow row={row} refetch={refetch} guide={{ projectId, number: row.number, headSha }} />
  );
}

function OpenGuidedPrRow({ row, refetch, guide }: { row: PrRow; refetch: (() => Promise<void>)[]; guide: GuideTarget }) {
  const read = useGuide(guide);
  return <PrRowButton row={row} current onClick={() => void Promise.all([...refetch, read.refetch].map((reread) => reread()))} />;
}

function useChooseProject() {
  const navigate = useBbNavigate();
  const select = useSelectProject();
  const choose = (projectId: string) => {
    navigate.toPluginPanel(PANEL_PATH, { subPath: routeSubPath({ kind: "project", projectId }) });
    // The hook's error state reports a failed write; the rejection itself carries nothing more.
    select.mutate({ projectId }).catch(() => undefined);
  };
  return { choose, error: select.error };
}

// At the panel root, open the remembered project, or the first GitHub project.
// An effect because navigating is a side effect on bb's router, driven by data that loads async.
function useOpenRememberedProject(route: Route, data: ReturnType<typeof useProjects>["data"]) {
  const navigate = useBbNavigate();
  const target = route.kind === "root" ? (data?.selectedProjectId ?? data?.projects.at(0)?.id) : undefined;
  useEffect(() => {
    if (target !== undefined) navigate.toPluginPanel(PANEL_PATH, { subPath: routeSubPath({ kind: "project", projectId: target }), replace: true });
  }, [target, navigate]);
}
