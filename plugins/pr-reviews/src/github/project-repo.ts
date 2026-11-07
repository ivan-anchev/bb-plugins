// A bb project's GitHub repo. bb records a project's remote when the project is created, so a
// project created before its `origin` existed has none; for those, read `origin` from the
// project's default checkout.
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
  /** No remote, or a remote off github.com. */
  | { kind: "none" }
  /** Reading the checkout's `origin` failed for a reason other than its absence. */
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

// The failures that mean there is no origin to read: the checkout's path is gone, it is not a
// git repository, or it has no `origin` remote. Anything else (git missing, a timeout, a
// broken config, a permission error) is reported rather than read as absence.
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
