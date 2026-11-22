import type { PrUnavailable } from "../../model/verdict/pr.ts";
import { firstLine, type HostCommandFailure } from "./host-command.ts";

const HTTP_STATUS = /\(HTTP (\d{3})\)/;

const TRANSPORT = [
  /error connecting to/i,
  /\bEOF\b/,
  /context deadline exceeded|Client\.Timeout exceeded|i\/o timeout|TLS handshake timeout/i,
  /x509:|\btls:/i,
  /dial tcp|connection refused|connection reset|broken pipe|network is unreachable|no route to host/i,
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
  if (killed || TRANSPORT.some((pattern) => pattern.test(stderr))) return UNREACHABLE;
  if (stderr.includes("gh auth login")) return SIGNED_OUT;
  const status = Number(HTTP_STATUS.exec(stderr)?.[1] ?? 0);
  if (status === 401) return REJECTED;
  if (status === 429 || (status === 403 && /rate limit/i.test(stderr))) return RATE_LIMITED;
  return transient(firstLine(stderr)?.replace(/^gh: /, "").trim() ?? `gh failed with no message (exit ${String(code)})`);
}

/** Why an answer gh gave could not be read as pull requests. why transient: the next answer may be. */
export const UNREADABLE_ANSWER = transient("GitHub's answer wasn't the pull requests the plugin asked for");
