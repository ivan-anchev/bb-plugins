// What a failed gh run tells the reader: a refusal the app shows beside its data, or beside a kept
// draft. Pure; its test runs it on failures recorded from real gh runs (fixtures/gh-failures).
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { firstLine, type HostCommandFailure } from "./host-command.ts";

// gh api ends an HTTP failure's stderr with "(HTTP 422)"; gh pr commands carry no status.
const HTTP_STATUS = /\(HTTP (\d{3})\)/;
const NETWORK = /error connecting to|could not resolve host|no such host|dial tcp|connection refused|i\/o timeout|TLS handshake/i;

export function ghRefusalFor(failure: HostCommandFailure): Refusal {
  const { code, stderr } = failure;
  if (code === "ENOENT") return invalid("PR Reviews needs the GitHub CLI. Install gh and make sure it is on your PATH, then Refresh.");
  if (code === "E2BIG") return invalid("The comment is too long to pass to the GitHub CLI. Shorten it, or select fewer lines.");
  if (NETWORK.test(stderr)) return invalid("Couldn't reach GitHub. Check the connection and try again.");
  const status = Number(HTTP_STATUS.exec(stderr)?.[1] ?? 0);
  if (stderr.includes("gh auth login") || status === 401) {
    return new Refusal({ code: "forbidden", message: "The GitHub CLI isn't signed in. Run `gh auth login`, then try again." });
  }
  if (status === 429 || (status === 403 && /rate limit/i.test(stderr))) return invalid("GitHub is limiting requests right now. Wait a minute and try again.");
  if (status === 403 && /locked/i.test(stderr)) return new Refusal({ code: "forbidden", message: "This conversation is locked on GitHub, so only collaborators can comment." });
  if (status === 403) return new Refusal({ code: "forbidden", message: "Your GitHub account doesn't have permission to do that in this repository." });
  if (status === 404 || stderr.includes("Could not resolve to a PullRequest")) {
    return new Refusal({ code: "not_found", message: "GitHub has no such pull request, or your account can't see it." });
  }
  // why GitHub's own words: a 422 names what it refused (a line it could not resolve, a commit not
  // in the PR), which no fixed message here can.
  if (status === 422) return invalid(`GitHub refused the comment: ${githubWordsOf(failure)}. The lines may no longer be in this commit's diff.`);
  return invalid(firstLine(stderr) ?? "The GitHub CLI failed.");
}

/**
 * A failed POST. One the timeout stopped may have reached GitHub, and posting again would post
 * twice, so it says so and is never retried; the reader checks the PR and decides.
 */
export function ghPostRefusalFor(failure: HostCommandFailure): Refusal {
  if (failure.killed) return invalid("GitHub didn't answer in time. The comment may have been posted: check the pull request before posting again.");
  return ghRefusalFor(failure);
}

const invalid = (message: string) => new Refusal({ code: "invalid", message });

// gh prints GitHub's error response on stdout and only its top message on stderr.
const githubErrorSchema = z.object({
  message: z.string(),
  errors: z.array(z.object({ field: z.string().optional(), message: z.string() })).default([]),
});

// "Validation Failed: pull_request_review_thread.line could not be resolved". A response gh did not
// print as GitHub's JSON leaves stderr, without gh's "gh: " and "(HTTP 422)".
function githubWordsOf({ stdout, stderr }: HostCommandFailure): string {
  const response = githubErrorSchema.safeParse(jsonOrNull(stdout));
  if (!response.success) return stderr.replace(/^gh: /, "").replace(HTTP_STATUS, "").trim();
  const details = response.data.errors.map(({ field, message }) => (field === undefined || message.startsWith(field) ? message : `${field} ${message}`));
  return [response.data.message, ...details].join(": ");
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
