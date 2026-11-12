// RPC handlers: resolve the project to its GitHub repo, read GitHub through gh with each PR's
// review state, read the sidebar's PRs across projects, stored guides, a PR's live diff and its
// comments, record the PR pages the reader opens, hand review actions to `reviews`, post the
// comments a reader chose to, and change a PR's state. A thin shell; the logic lives in the
// modules it calls.
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi, type ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { commentsTag, INBOX_TAG, prReviewsContract, prsOf, repoTag, VISITS_TAG, type GitHubProject, type UnreadableProject } from "../contract.ts";
import { parsePrDiff } from "../diff/parse-pr-diff.ts";
import { changePrState, listOpenPrs, postComment, postConversationComment, postReply, readFileAt, readInbox, readPrComments, snapshotPrDiff, type PrDiffSnapshot } from "../github/gh.ts";
import { projectRepo, type ProjectRepo } from "../github/project-repo.ts";
import type { Repo } from "../github/repo.ts";
import { buildSections, inboxPrs } from "./inbox.ts";
import type { ReviewReader } from "./review-reader.ts";
import type { PrRef, Reviews } from "./reviews.ts";
import { createSidebarCatchUp } from "./sidebar-catch-up.ts";
import type { Store } from "./store.ts";

// A deleted project reads as one without a remote.
const NO_REMOTE: ProjectRepo = { kind: "none" };

type Handlers = ExperimentalPluginRpcHandlersWithContext<typeof prReviewsContract>;

// The parts of bb the handlers use, down to the fields they read.
type Bb = {
  sdk: { projects: { list(): Promise<readonly ({ id: string; name: string } & Parameters<typeof projectRepo>[0])[]> } };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  onDispose: BbPluginApi["onDispose"];
};

type Deps = { bb: Bb; store: Pick<Store, "guide" | "snapshotFiles" | "saveVisit" | "visits">; reader: ReviewReader; reviews: Reviews };

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

  async function readSidebar() {
    const { projects, unreadable } = await githubProjects();
    const { found, stackMates } = await readInbox([...new Set(projects.map((project) => project.repo))], Date.now());
    return { sections: buildSections(inboxPrs(found, stackMates, projects)), unreadable };
  }

  const sidebarCatchUp = createSidebarCatchUp({
    readListed: async () => (await readSidebar()).sections.flatMap(prsOf),
    invalidate: () => bb.rpc.experimental_invalidate([INBOX_TAG]),
  });
  bb.onDispose(sidebarCatchUp.dispose);

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

  return {
    inbox: readSidebar,

    visits: async () => ({ visits: store.visits() }),

    // Timed at the opening, before the remote read: a page opened earlier, whose project's remote
    // reads slower, still records the earlier visit.
    async recordVisit({ projectId, number }) {
      const openedAt = Date.now();
      store.saveVisit({ projectId, repo: await repoOf(projectId), number, openedAt });
      bb.rpc.experimental_invalidate([VISITS_TAG]);
      return {};
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

    async askAboutGitHubThread({ thread, question, ...input }) {
      await reviews.askAboutGitHubThread(await prRef(input), thread, question);
      return {};
    },

    comments: async ({ projectId, number }) => readPrComments(await repoOf(projectId), number),

    // The repo is the project's, read here: the app names only the project and the PR.
    postComment: ({ request, ...target }) => posted(target, (repo) => postComment(repo, target.number, request)),

    replyToThread: ({ commentId, body, ...target }) => posted(target, (repo) => postReply(repo, target.number, commentId, body)),

    postConversationComment: ({ body, ...target }) => posted(target, (repo) => postConversationComment(repo, target.number, body)),

    // The page header reads the PR under its repo's tag, and the sidebar under its own, so both
    // show the new state. The sidebar reads GitHub's search, which can still list the old state at
    // first: the catch-up has it read again once the search lists the new one.
    async changePrState({ projectId, number, change }) {
      const repo = await repoOf(projectId);
      await changePrState(repo, number, change);
      bb.rpc.experimental_invalidate([repoTag(repo), INBOX_TAG]);
      sidebarCatchUp.follow(repo, number, change);
      return {};
    },
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
