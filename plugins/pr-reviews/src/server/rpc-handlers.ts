// RPC handlers: resolve the project to its GitHub repo, read GitHub through gh with each PR's
// review state, read stored guides, a PR's live diff and its comments, remember the chosen
// project, hand review actions to `reviews`, and post the comments a reader chose to. A thin shell;
// the logic lives in the modules it calls.
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi, type ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { commentsTag, PROJECTS_TAG, prReviewsContract, type GitHubProject, type UnreadableProject } from "../contract.ts";
import { parsePrDiff } from "../diff/parse-pr-diff.ts";
import { listOpenPrs, postComment, postConversationComment, postReply, readFileAt, readPrComments, snapshotPrDiff, type PrDiffSnapshot } from "../github/gh.ts";
import { projectRepo, type ProjectRepo } from "../github/project-repo.ts";
import type { Repo } from "../github/repo.ts";
import type { ReviewReader } from "./review-reader.ts";
import type { PrRef, Reviews } from "./reviews.ts";
import type { Store } from "./store.ts";

const SELECTED_PROJECT_KEY = "selected-project";

// A deleted project reads as one without a remote.
const NO_REMOTE: ProjectRepo = { kind: "none" };

type Handlers = ExperimentalPluginRpcHandlersWithContext<typeof prReviewsContract>;

// The parts of bb the handlers use, down to the fields they read.
type Bb = {
  sdk: { projects: { list(): Promise<readonly ({ id: string; name: string } & Parameters<typeof projectRepo>[0])[]> } };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  storage: { kv: Pick<BbPluginApi["storage"]["kv"], "get" | "set"> };
};

type Deps = { bb: Bb; store: Pick<Store, "guide" | "snapshotFiles">; reader: ReviewReader; reviews: Reviews };

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

  // The PR's comments re-read once GitHub has the new one, so it shows in place.
  async function posted(target: { projectId: string; number: number }, post: (repo: Repo) => Promise<{ url: string }>): Promise<{ url: string }> {
    const result = await post(await repoOf(target.projectId));
    bb.rpc.experimental_invalidate([commentsTag(target)]);
    return result;
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

    async changes({ projectId, number }) {
      return changesOf(await snapshotPrDiff(await repoOf(projectId), number));
    },

    async fileContent({ projectId, sha, path }) {
      return { content: await readFileAt(await repoOf(projectId), sha, path) };
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

    updateGuide: async (input) => reviews.update(await prRef(input)),

    async askAboutFinding({ projectId, number, headSha, findingIndex, question }) {
      await reviews.ask({ repo: await repoOf(projectId), number, headSha }, findingIndex, question);
      return {};
    },

    async askAboutLines({ quote, question, ...input }) {
      await reviews.askAboutLines(await prRef(input), quote, question);
      return {};
    },

    comments: async ({ projectId, number }) => readPrComments(await repoOf(projectId), number),

    // The repo is the project's, read here: the app names only the project and the PR.
    postComment: ({ request, ...target }) => posted(target, (repo) => postComment(repo, target.number, request)),

    replyToThread: ({ commentId, body, ...target }) => posted(target, (repo) => postReply(repo, target.number, commentId, body)),

    postConversationComment: ({ body, ...target }) => posted(target, (repo) => postConversationComment(repo, target.number, body)),
  };
}

// A diff the parser refuses (cut short, or a file name it can't read) is a failed read the
// Changes tab shows, not a crash.
function changesOf({ headSha, diff }: PrDiffSnapshot) {
  try {
    return { headSha, files: parsePrDiff(diff) };
  } catch (error) {
    throw new Refusal({ code: "invalid", message: `GitHub's diff of this PR could not be read. ${error instanceof Error ? error.message : String(error)}` });
  }
}
