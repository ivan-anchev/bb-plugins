// Runs a forge's CLI, gh or glab, on the bb server's machine and returns its stdout; a failure
// rejects with Node's ExecFileException, which cliFailure turns into why the read failed. Copied in
// part from pr-reviews (src/github/host-command.ts): a plugin installs standalone, so it can't
// import another's.
import { experimental_execHostFile as execHostFile, experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import { z } from "zod";
import type { Forge, PrUnavailable } from "../../model/verdict/pr.ts";

/** The forge CLIs the PR watch runs. */
export type Cli = "gh" | "glab";

/** Runs a CLI with these arguments and resolves to its stdout; rejects as Node's execFile does. The watch's one seam to the host. */
export type RunCli = (cli: Cli, args: string[]) => Promise<string>;

// Keeps each CLI from ever waiting on a prompt or a pager, checking for updates or sending
// telemetry, and keeps its messages in English so the watch can classify stderr.
const QUIET_ENV: Record<Cli, Record<string, string>> = {
  gh: { GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", NO_COLOR: "1", LC_ALL: "C" },
  glab: { NO_PROMPT: "1", PAGER: "cat", GLAB_CHECK_UPDATE: "false", GLAB_SEND_TELEMETRY: "false", NO_COLOR: "1", LC_ALL: "C" },
};

/**
 * A CLI's environment: ours with its QUIET_ENV on top. hostToolchain.environment builds the child's
 * env from its argument alone (adding only PATH and proxies), so without the spread the CLI loses
 * HOME and every config and credential variable, and asks to be signed in.
 */
const hostCommandEnvironment = (cli: Cli) => hostToolchain.environment({ ...process.env, ...QUIET_ENV[cli] });

// execHostFile resolves the CLI on the login-shell PATH, which a GUI-launched bb would otherwise lack.
export const runHostCli: RunCli = async (cli, args) => {
  const { stdout } = await execHostFile(cli, args, {
    encoding: "utf8",
    env: hostCommandEnvironment(cli),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
};

// Node's ExecFileException, parsed rather than cast. `code` is the exit code, or a spawn error:
// "ENOENT" when the CLI is not installed. `killed`: the timeout stopped it.
const failureSchema = z.object({ code: z.unknown(), stdout: z.string().default(""), stderr: z.string().default(""), killed: z.boolean().default(false) });
export type HostCommandFailure = z.infer<typeof failureSchema>;

/** The exit code, output and timeout flag of a runHostCli rejection. */
export const parseHostCommandFailure = (error: unknown): HostCommandFailure => failureSchema.parse(error);

const firstLine = (text: string) => text.split("\n").find((line) => line.trim() !== "");

// gh and glab end an HTTP failure's stderr with "(HTTP 401)".
const HTTP_STATUS = /\(HTTP (\d{3})\)/;

// Every way a Go CLI, gh or glab, through Go's net, net/http and crypto/tls, reports a connection that failed before its forge answered.
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

/** Whether a CLI's message says the connection failed before its forge answered. */
const connectionFailed = (text: string): boolean => TRANSPORT.some((pattern) => pattern.test(text));

/** A CLI's words for each failure it can prove, as the board shows them after its forge's label. */
export type CliWords = { cli: Cli; forge: Forge; notInstalled: string; signedOut: string; rejected: string; unreachable: string; rateLimited: string };

/**
 * Why a run of a CLI failed, in its words, and whether it lasts. It says only what the failure
 * proves: a missing CLI, a sign-in it asks for and credentials the forge rejected last until
 * someone acts; a connection that failed before the forge answered, a rate limit and the CLI's own
 * first line for anything else may pass by the next read.
 */
export function cliFailure(words: CliWords, { code, stderr, killed }: HostCommandFailure): PrUnavailable {
  const persistent = (reason: string): PrUnavailable => ({ kind: "persistent", reason, forge: words.forge });
  const transient = (reason: string): PrUnavailable => ({ kind: "transient", reason, forge: words.forge });
  if (code === "ENOENT") return persistent(words.notInstalled);
  // why a timeout is a connection failure: the CLI waits on nothing else.
  if (killed || connectionFailed(stderr)) return transient(words.unreachable);
  if (stderr.includes(`${words.cli} auth login`)) return persistent(words.signedOut);
  const status = Number(HTTP_STATUS.exec(stderr)?.[1] ?? 0);
  if (status === 401) return persistent(words.rejected);
  if (status === 429 || (status === 403 && /rate limit/i.test(stderr))) return transient(words.rateLimited);
  // why transient: nothing shows it lasts, and a verdict settled on it never waits for CI again.
  return transient(firstLine(stderr)?.replace(new RegExp(`^${words.cli}: `), "").trim() ?? `${words.cli} failed with no message (exit ${String(code)})`);
}
