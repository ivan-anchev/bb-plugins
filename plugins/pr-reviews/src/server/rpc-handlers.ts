// RPC handlers: resolve the project to its GitHub repo, read GitHub through gh with each PR's
// review state, read stored guides, remember the chosen project, and hand review actions to
// `reviews`. A thin shell; the logic lives in the modules it calls.
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi, type ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PROJECTS_TAG, prReviewsContract, type GitHubProject, type UnreadableProject } from "../contract.ts";
import { listOpenPrs } from "../github/gh.ts";
import { projectRepo, type ProjectRepo } from "../github/project-repo.ts";
import type { Repo } from "../github/repo.ts";
import type { ReviewReader } from "./review-reader.ts";
import type { PrRef, Reviews } from "./reviews.ts";
import type { Store } from "./store.ts";

const SELECTED_PROJECT_KEY = "selected-project";

// A deleted project reads as one without a remote.
const NO_REMOTE: ProjectRepo = { kind: "none" };

type Handlers = ExperimentalPluginRpcHandlersWithContext<typeof prReviewsContract>;

type Deps = { bb: BbPluginApi; store: Pick<Store, "guide" | "snapshotFiles">; reader: ReviewReader; reviews: Reviews };

export function createRpcHandlers({ bb, store, reader, reviews }: Deps): Handlers {
  // One project's unreadable remote is reported beside the others, never failing the read.
  async function githubProjects(): Promise<{ projects: GitHubProject[]; unreadable: UnreadableProject[] }> {
    const projects = await bb.sdk.projects.list();
    const reads = await Promise.all(projects.map(async ({ id, name, ...project }) => ({ id, name, read: await projectRepo(project) })));
    return {
      projects: reads.flatMap(({ id, name, read }) => (read.kind === "github" ? [{ id, name, repo: read.repo }] : [])),
      unreadable: reads.flatMap(({ id, name, read }) => (read.kind === "unreadable" ? [{ id, name, message: read.message }] : [])),
    };
  }

  async function repoOf(projectId: string): Promise<Repo> {
    const project = (await bb.sdk.projects.list()).find((candidate) => candidate.id === projectId);
    const read = project === undefined ? NO_REMOTE : await projectRepo(project);
    switch (read.kind) {
      case "github":
        return read.repo;
      case "none":
        throw new Refusal({ code: "not_found", message: "That project has no GitHub remote." });
      case "unreadable":
        throw new Refusal({ code: "invalid", message: read.message });
    }
  }

  async function prRef({ projectId, number }: { projectId: string; number: number }): Promise<PrRef> {
    return { projectId, repo: await repoOf(projectId), number };
  }

  async function rememberedProjectId(): Promise<string | undefined> {
    return z.string().optional().parse(await bb.storage.kv.get(SELECTED_PROJECT_KEY));
  }

  return {
    async projects() {
      const [{ projects, unreadable }, remembered] = await Promise.all([githubProjects(), rememberedProjectId()]);
      // A remembered project that was deleted, or lost its GitHub remote, reads as none chosen.
      const selected = projects.find((project) => project.id === remembered);
      return { projects, unreadable, selectedProjectId: selected?.id ?? null };
    },

    async pullRequests({ projectId }) {
      const repo = await repoOf(projectId);
      const prs = await listOpenPrs(repo);
      return { repo, rows: await reader.withReviews(repo, prs) };
    },

    async pullRequest({ projectId, number }) {
      const repo = await repoOf(projectId);
      return { repo, ...(await reader.pullRequest(repo, number)) };
    },

    async guide({ projectId, number, headSha }) {
      const key = { repo: await repoOf(projectId), number, headSha };
      const record = store.guide(key);
      if (record === null) throw new Refusal({ code: "not_found", message: "This PR has no guide for that commit." });
      return { record, files: store.snapshotFiles(key) };
    },

    async selectProject({ projectId }) {
      await bb.storage.kv.set(SELECTED_PROJECT_KEY, projectId);
      bb.rpc.experimental_invalidate([PROJECTS_TAG]);
      return {};
    },

    startReview: async (input) => reviews.start(await prRef(input)),

    async cancelReview(input) {
      await reviews.cancel(await prRef(input));
      return {};
    },

    async nudgeReview(input) {
      await reviews.nudge(await prRef(input));
      return {};
    },
  };
}
