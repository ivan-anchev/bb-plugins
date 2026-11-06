import { z } from "zod";

// why a brand: a repo slug and a project id are both strings; only parsing mints a Repo.
export const repoSchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/).brand<"Repo">();
export type Repo = z.infer<typeof repoSchema>;

// The remote shapes git writes for github.com:
//   git@github.com:owner/name(.git)
//   ssh://git@github.com/owner/name(.git)
//   https://github.com/owner/name(.git)(/), optionally with user@
const GITHUB_REMOTE = /^(?:git@github\.com:|(?:ssh|https?|git):\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

/** The `owner/name` of a github.com remote, or null for any other remote. */
export function parseGitHubRepo(remoteUrl: string): Repo | null {
  const match = GITHUB_REMOTE.exec(remoteUrl.trim());
  return match === null ? null : repoSchema.parse(`${match[1]}/${match[2]}`);
}
