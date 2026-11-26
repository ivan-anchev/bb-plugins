// Which forge, host and project a project's git remote is on, or why the plugin can't read change
// requests there. github.com is GitHub; any other host is GitLab once glab on the machine running
// bb is signed in to it. No setting, no host list, no probe: glab's own sign-in is the one
// authority on which hosts are GitLab, as gh's and glab's remote resolvers treat their config. A
// reason names the host, never the remote, which may carry a token.
import type { PrUnavailable } from "../../model/verdict/pr.ts";
import { glabSignIn } from "./gitlab/sign-in.ts";
import type { RunCli } from "./host-command.ts";

/** A project the watch can read: on github.com as `owner/name`, or on a GitLab host glab is signed in to as `group/…/project`. */
export type ForgeRepo = { forge: "github"; host: "github.com"; path: string } | { forge: "gitlab"; host: string; path: string };

/** Where a project's remote is: on a forge the watch reads, or off them, with why. */
export type Located = { kind: "on-forge"; repo: ForgeRepo } | { kind: "off-forge"; unavailable: PrUnavailable };

/** A remote as parsed: its host, lower case, and its project path; `httpPort`: an http(s) remote names a port. */
type Remote = { host: string; path: string; httpPort: boolean };

const offForge = (reason: string): Located => ({ kind: "off-forge", unavailable: { kind: "persistent", reason, forge: null } });

/**
 * The locator of one plugin instance: `locate` says where a remote is, and `forget` drops a host
 * from those it knows glab is signed in to. why remembered for the plugin's life: a signed-in host
 * stays GitLab, and asking glab each tick would spawn it once a minute per project. why forget: a
 * read of a host that came back unavailable may mean the sign-in went, so the next locate asks
 * glab again and says so in glab's own words.
 */
export function createLocator(run: RunCli) {
  const signedIn = new Set<string>();

  async function locate(remoteUrl: string | null): Promise<Located> {
    if (remoteUrl === null) return offForge("its project has no git remote");
    const remote = parseRemote(remoteUrl);
    if (remote === null) return offForge("its project's git remote isn't one the plugin can read");
    const { host, path, httpPort } = remote;
    if (httpPort) return offForge(`its project's git remote on ${host} names a port, which the plugin doesn't read`);
    if (host === "github.com") return isOwnerName(path) ? { kind: "on-forge", repo: { forge: "github", host, path } } : offForge("its project's git remote on github.com names no owner/name repository");
    if (!signedIn.has(host)) {
      const signIn = await glabSignIn(run, host);
      if (signIn.kind === "refused") return { kind: "off-forge", unavailable: signIn.unavailable };
      signedIn.add(host);
    }
    return { kind: "on-forge", repo: { forge: "gitlab", host, path } };
  }

  return { locate, forget: (host: string): void => void signedIn.delete(host) };
}

// scp-like, as git writes it: [user@]host:path, with no scheme.
const SCP = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/;
const SCHEMES = new Set(["ssh:", "git:", "http:", "https:"]);
// A project path on either forge: two or more segments of letters, digits, `_`, `-` and `.`.
const PROJECT_PATH = /^[\w.-]+(?:\/[\w.-]+)+$/;

/**
 * The host and project path of a remote: scp-like, ssh://, git:// or http(s)://. An ssh port is
 * dropped, as gh and glab drop it (station-ws is ssh on 8022); userinfo is dropped; `.git` and
 * slashes at either end are dropped. null: not a remote the plugin can read.
 */
function parseRemote(remoteUrl: string): Remote | null {
  const text = remoteUrl.trim();
  const scp = text.includes("://") ? null : SCP.exec(text);
  if (scp !== null) return remoteOf(scp[1] ?? "", scp[2] ?? "", false);
  const url = URL.parse(text);
  if (url === null || !SCHEMES.has(url.protocol)) return null;
  return remoteOf(url.hostname, url.pathname, url.port !== "" && url.protocol.startsWith("http"));
}

function remoteOf(host: string, rawPath: string, httpPort: boolean): Remote | null {
  const path = rawPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return host !== "" && PROJECT_PATH.test(path) ? { host: host.toLowerCase(), path, httpPort } : null;
}

const isOwnerName = (path: string): boolean => path.split("/").length === 2;
