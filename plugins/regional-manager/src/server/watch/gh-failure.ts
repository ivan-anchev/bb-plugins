// Why a read of GitHub failed, in the words the board shows after "PR status unavailable:", and
// whether it lasts. It says only what gh's failure proves: a missing gh, a sign-in gh asks for and
// credentials GitHub rejected last until someone acts; a connection that failed before GitHub
// answered, a rate limit and gh's own first line for anything else may pass by the next read.
// Patterns from pr-reviews (src/github/gh-refusal.ts).
import type { PrUnavailable } from "../../model/verdict/pr.ts";
import { firstLine, type HostCommandFailure } from "./host-command.ts";

// gh api ends an HTTP failure's stderr with "(HTTP 401)".
const HTTP_STATUS = /\(HTTP (\d{3})\)/;

// Every way gh, through Go's net, net/http and crypto/tls, reports a connection that failed before GitHub answered.
const TRANSPORT = [
  // gh's own words for it.
  /error connecting to/i,
  // The connection closed mid-answer: Go's bare "EOF", or "unexpected EOF".
  /\bEOF\b/,
  // A timeout: the request's, the dial's or the TLS handshake's.
  /context deadline exceeded|Client\.Timeout exceeded|i\/o timeout|TLS handshake timeout/i,
  // A certificate or TLS failure.
  /x509:|\btls:/i,
  // The connection refused, reset or never routed.
  /dial tcp|connection refused|connection reset|broken pipe|network is unreachable|no route to host/i,
  // The name never resolved.
  /no such host|could not resolve host|server misbehaving|temporary failure in name resolution/i,
];

const persistent = (reason: string): PrUnavailable => ({ kind: "persistent", reason });
const transient = (reason: string): PrUnavailable => ({ kind: "transient", reason });

const NOT_INSTALLED = persistent("gh, the GitHub CLI, isn't installed on the machine running bb");
const SIGNED_OUT = persistent("gh isn't signed in on the machine running bb: run gh auth login there");
const REJECTED = persistent("GitHub rejected gh's credentials on the machine running bb (HTTP 401): check gh auth status there");
const UNREACHABLE = transient("couldn't reach GitHub");
const RATE_LIMITED = transient("GitHub is limiting requests right now");

export function ghFailure({ code, stderr, killed }: HostCommandFailure): PrUnavailable {
  if (code === "ENOENT") return NOT_INSTALLED;
  // why a timeout is a connection failure: gh waits on nothing else.
  if (killed || TRANSPORT.some((pattern) => pattern.test(stderr))) return UNREACHABLE;
  if (stderr.includes("gh auth login")) return SIGNED_OUT;
  const status = Number(HTTP_STATUS.exec(stderr)?.[1] ?? 0);
  if (status === 401) return REJECTED;
  if (status === 429 || (status === 403 && /rate limit/i.test(stderr))) return RATE_LIMITED;
  // why transient: nothing shows it lasts, and a verdict settled on it never waits for CI again.
  return transient(firstLine(stderr)?.replace(/^gh: /, "").trim() ?? `gh failed with no message (exit ${String(code)})`);
}

/** Why an answer gh gave could not be read as pull requests. why transient: the next answer may be. */
export const UNREADABLE_ANSWER = transient("GitHub's answer wasn't the pull requests the plugin asked for");
