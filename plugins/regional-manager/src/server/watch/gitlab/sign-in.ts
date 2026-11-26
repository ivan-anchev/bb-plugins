// Whether glab on the machine running bb is signed in to a host, which is how the plugin knows a
// host is GitLab; or why it can't read merge requests there, in words that name the host and what
// fixes it. glab 1.122 and later: `auth status --hostname H --output json` prints
// {"hosts":[{host, state, error, …}]} on stdout, exiting 0 when signed in, and 1 with the JSON
// still on stdout when the check failed (review.md, glab 1.131.0 live; context.md §1.4).
import { z } from "zod";
import type { PrUnavailable } from "../../../model/verdict/pr.ts";
import { connectionFailed, jsonOrNull, parseHostCommandFailure, type HostCommandFailure, type RunCli } from "../host-command.ts";
import { glabWords } from "./glab-failure.ts";

export type SignIn = { kind: "signed-in" } | { kind: "refused"; unavailable: PrUnavailable };

/** Asks glab whether it is signed in to `host`. Signed in only when the host's entry reads `state: "success"`. */
export async function glabSignIn(run: RunCli, host: string): Promise<SignIn> {
  let stdout: string;
  try {
    stdout = await run("glab", ["auth", "status", "--hostname", host, "--output", "json"]);
  } catch (error) {
    return refused(whyNot(host, parseHostCommandFailure(error)));
  }
  return entryOf(stdout, host)?.state === "success" ? { kind: "signed-in" } : refused(notSignedIn(host));
}

/**
 * Why an `auth status` that failed doesn't sign the host in. why forge null on some: glab doesn't
 * know the host, so nothing says it is GitLab; where glab has the host and its check failed, it is.
 */
function whyNot(host: string, failure: HostCommandFailure): PrUnavailable {
  const gitlab = glabWords(host);
  if (failure.code === "ENOENT") return { kind: "persistent", forge: null, reason: `${host} isn't github.com, and glab, the GitLab CLI, isn't installed on the machine running bb: if ${host} is a GitLab, install glab there and run glab auth login --hostname ${host}` };
  // why transient: the ask got no answer, which says nothing about the sign-in, so a waiting verdict keeps waiting.
  if (failure.killed) return { kind: "transient", forge: null, reason: `glab didn't answer whether it is signed in to ${host} on the machine running bb` };
  if (/unknown flag: --output/.test(failure.stderr)) return { kind: "persistent", forge: null, reason: `glab on the machine running bb is older than 1.122, which reading GitLab at ${host} needs: update it there` };
  const entry = entryOf(failure.stdout, host);
  if (entry?.state === "error") return checkFailed(host, entry.error);
  if (connectionFailed(failure.stderr)) return { kind: "transient", forge: "gitlab", reason: gitlab.unreachable };
  return notSignedIn(host);
}

/** Why glab's check of a host it has failed: a connection that never answered may pass; credentials GitLab rejected, and any other failure, last until someone signs in again. */
function checkFailed(host: string, error: string): PrUnavailable {
  const gitlab = glabWords(host);
  // why: glab may word a host it has no sign-in for as an entry, as well as a message alone.
  if (/has not been authenticated/.test(error)) return notSignedIn(host);
  if (connectionFailed(error)) return { kind: "transient", forge: "gitlab", reason: gitlab.unreachable };
  if (/\b401\b/.test(error)) return { kind: "persistent", forge: "gitlab", reason: gitlab.rejected };
  return { kind: "persistent", forge: "gitlab", reason: `glab's sign-in to ${host} failed on the machine running bb: run glab auth login --hostname ${host} there` };
}

const notSignedIn = (host: string): PrUnavailable => ({
  kind: "persistent",
  forge: null,
  reason: `${host} isn't github.com, and glab on the machine running bb isn't signed in to it: if it is a GitLab, run glab auth login --hostname ${host} there`,
});

const refused = (unavailable: PrUnavailable): SignIn => ({ kind: "refused", unavailable });

// why `catch` on error: only the asked host's state is read, and an error glab words some other way is still an error.
const statusSchema = z.object({ hosts: z.array(z.object({ host: z.string(), state: z.string(), error: z.string().catch("") })) });

/** The asked host's entry in glab's JSON (undefined: none, or not JSON). why never shown: `error` is glab's text; only how it is classified reaches a reason. */
function entryOf(stdout: string, host: string) {
  const parsed = statusSchema.safeParse(jsonOrNull(stdout));
  return parsed.success ? parsed.data.hosts.find((entry) => entry.host.toLowerCase() === host) : undefined;
}
