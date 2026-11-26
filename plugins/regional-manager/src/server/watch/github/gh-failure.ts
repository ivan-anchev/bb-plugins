// Why a read of GitHub failed, in the words the board shows after "PR status unavailable:", and
// whether it lasts: gh's words for each failure host-command.ts cliFailure tells apart. Patterns
// from pr-reviews (src/github/gh-refusal.ts).
import type { PrUnavailable } from "../../../model/verdict/pr.ts";
import { cliFailure, type CliWords, type HostCommandFailure } from "../host-command.ts";

const GH_WORDS: CliWords = {
  cli: "gh",
  notInstalled: "gh, the GitHub CLI, isn't installed on the machine running bb",
  signedOut: "gh isn't signed in on the machine running bb: run gh auth login there",
  rejected: "GitHub rejected gh's credentials on the machine running bb (HTTP 401): check gh auth status there",
  unreachable: "couldn't reach GitHub",
  rateLimited: "GitHub is limiting requests right now",
};

export const ghFailure = (failure: HostCommandFailure): PrUnavailable => cliFailure(GH_WORDS, failure);

/** Why an answer gh gave could not be read as pull requests. why transient: the next answer may be. */
export const UNREADABLE_ANSWER: PrUnavailable = { kind: "transient", reason: "GitHub's answer wasn't the pull requests the plugin asked for" };
