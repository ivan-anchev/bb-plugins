import { firstLine, parseHostCommandFailure, runHostCommand } from "./host-command.ts";
import { parseGitHubRepo, type Repo } from "./repo.ts";

/** The fields of a bb project this module reads. */
interface BbProject {
  gitRemoteUrl: string | null;
  sources: readonly { path: string; isDefault: boolean }[];
}

/** What a project's remote says about its GitHub repo. */
export type ProjectRepo =
  | { kind: "github"; repo: Repo }
  | { kind: "none" }
  | { kind: "unreadable"; message: string };

const NONE: ProjectRepo = { kind: "none" };

export async function projectRepo(project: BbProject): Promise<ProjectRepo> {
  if (project.gitRemoteUrl !== null) return fromRemote(project.gitRemoteUrl);
  const checkout = project.sources.find((source) => source.isDefault);
  return checkout === undefined ? NONE : checkoutRepo(checkout.path);
}

const checkoutRepo = (path: string): Promise<ProjectRepo> =>
  runHostCommand("git", ["-C", path, "remote", "get-url", "origin"]).then(fromRemote, fromGitFailure);

function fromRemote(remote: string): ProjectRepo {
  const repo = parseGitHubRepo(remote);
  return repo === null ? NONE : { kind: "github", repo };
}

const NO_ORIGIN = [
  /^fatal: cannot change to '.*': No such file or directory$/m,
  /^fatal: not a git repository/m,
  /^error: No such remote 'origin'$/m,
];

function fromGitFailure(error: unknown): ProjectRepo {
  const { code, stderr } = parseHostCommandFailure(error);
  if (NO_ORIGIN.some((pattern) => pattern.test(stderr))) return NONE;
  if (code === "ENOENT") return { kind: "unreadable", message: "PR Reviews needs git. Install it and make sure it is on your PATH." };
  return { kind: "unreadable", message: firstLine(stderr) ?? "git could not read the checkout's origin." };
}
