// Which GitHub login a thread sandbox uses, and the `bb boat status` rows that say so. The order is fixed:
// bb's forwarded login wins on every remote machine whenever core sends one (clone included); otherwise
// boat's GITHUB_TOKEN, which daemon-setup.ts makes work for SSH remotes too.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Account, GithubApp, SandboxEnvironment } from "./boat/wire.ts";
import type { Read } from "./settle.ts";
import { enableCommand } from "./sign-ins.ts";

/** bb's own state of its forwarded GitHub login (`bb.sdk.system.machineEnvironment().builtInGit.status`). */
type BuiltInGitStatus = Awaited<ReturnType<BbPluginApi["sdk"]["system"]["machineEnvironment"]>>["builtInGit"]["status"];

export type GithubSource =
  | { kind: "bb-forwarded" }
  | { kind: "bb-machine-env" }
  | { kind: "boat"; whyNotBb: string };

const FORWARDING_SETTING = "bb settings general machineGitCredentialsEnabled";

/** bb's GitHub login state as a source; a state newer than this plugin's SDK reads unknown. */
export function githubSourceOf(status: BuiltInGitStatus): Read<GithubSource> {
  switch (status) {
    case "logged in":
      return { ok: true, value: { kind: "bb-forwarded" } };
    case "overridden":
      return { ok: true, value: { kind: "bb-machine-env" } };
    case "disabled":
      return { ok: true, value: { kind: "boat", whyNotBb: "bb's automatic GH_TOKEN is off" } };
    case "not logged in":
      // Core sends nothing when `gh auth token` fails on the bb server.
      return { ok: true, value: { kind: "boat", whyNotBb: "gh on the bb server is not logged in" } };
    default:
      // why: host data; a newer bb can send a state the SDK pin does not list.
      return { ok: false, reason: `bb reports its GitHub login as "${String(status satisfies never)}", which this plugin does not know` };
  }
}

/** What boat's path depends on: the account's GitHub link, the default launch's environment and the App. */
export interface BoatGithub {
  account: Account;
  environment: Read<SandboxEnvironment>;
  app: Read<GithubApp>;
}

const CONNECT = "Click Connect GitHub on https://boat.dev/dashboard?tab=environment";

/** The GitHub rows: the source in use and why, then on boat's path every gap, each with a `Fix:` line. */
export function githubLines(source: Read<GithubSource>, boat: BoatGithub): string[] {
  if (!source.ok) return [`GitHub: unknown (${source.reason})`];
  switch (source.value.kind) {
    case "bb-forwarded":
      return [
        "GitHub: bb's forwarded login (gh on the bb server), on every bb machine, clone included",
        `To use boat's GitHub token instead, turn off bb's automatic GH_TOKEN: \`${FORWARDING_SETTING} false\``,
      ];
    case "bb-machine-env":
      return ["GitHub: the GH_TOKEN in bb's machine environment, which wins over boat's"];
    case "boat":
      return [
        ...environmentLines(source.value.whyNotBb, boat.environment),
        ...accountLines(boat.account),
        ...(boat.environment.ok ? passLines(boat.environment.value) : []),
        ...appLines(boat.app),
      ];
    default:
      return source.value satisfies never;
  }
}

function environmentLines(whyNotBb: string, environment: Read<SandboxEnvironment>): string[] {
  const why = `bb forwards no GitHub login: ${whyNotBb}`;
  return environment.ok
    ? [`GitHub: boat's token from environment ${environment.value.name} (${why})`]
    : [`GitHub: boat's token (${why}); whether boat passes it is unknown (${environment.reason})`];
}

function accountLines(account: Account): string[] {
  return account.githubLinked ? [] : ["boat account: not linked to GitHub", `Fix: ${CONNECT}`];
}

function passLines(environment: SandboxEnvironment): string[] {
  if (!environment.withholdsAll && environment.passes.github) return [];
  return [`Environment ${environment.name} does not pass GitHub`, `Fix: Run \`${enableCommand(environment, "--github")}\``];
}

function appLines(app: Read<GithubApp>): string[] {
  if (!app.ok) return [`boat GitHub App: unknown (${app.reason})`];
  if (app.value.owners.length === 0)
    return [
      "boat GitHub App: not installed, so boat's token can read public repositories and push to none",
      `Fix: ${CONNECT}, and install the app for the owners of your repositories`,
    ];
  return [`boat GitHub App: installed for ${app.value.owners.join(", ")}`];
}
