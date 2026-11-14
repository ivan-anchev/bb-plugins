// boat's JSON, parsed once. This is the only module that knows boat's field names;
// every other module trusts the types these schemas produce.
//
// What boat API v1 responses carry:
// - /me: `user.id` is the account id (OpenAPI: "Your account id"; it reads `sandbox_<32 hex>`),
//   `user.login`, `user.zeroDataRetention`.
// - /limits reads the wallet a create would bill (the key's active wallet). It carries `teamId`
//   only when that is an organization wallet. `starts.{minute,hour,day}` are `{limit, used, remaining}`,
//   all null when `starts.unlimited`. `canStart` / `startBlockedReason` say whether any start can run.
// - /environments `environments[]` carries the pass toggles, `safeForThirdParties` (which overrides
//   them), `proxyAiCredentials` and `credentialProfileId` (null: the sandbox owner's default profile).
// - /credential-profiles `profiles[]` carries `connected` (credential ids such as
//   `claude-subscription`, never a secret) and `owner.{id, aiProxyEnabled}`.
// - /me `user.connectionMethods` lists every login method linked to the account; `github` is the link
//   boat's GitHub token comes from.
import { z } from "zod";

export const sandboxId = z.string().regex(/^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/).brand<"SandboxId">();
export const accountId = z.string().min(1).brand<"AccountId">();
const instant = z.iso.datetime().transform((value) => Date.parse(value));

export const wireMe = z
  .object({
    user: z.object({ id: accountId, login: z.string(), zeroDataRetention: z.boolean(), connectionMethods: z.array(z.string()) }),
  })
  .transform(({ user }) => ({
    id: user.id,
    login: user.login,
    zeroDataRetention: user.zeroDataRetention,
    /** boat can give sandboxes a GitHub token only for an account linked to GitHub. */
    githubLinked: user.connectionMethods.includes("github"),
  }));

const startWindow = z.object({ limit: z.number().int(), used: z.number().int() });

/**
 * What the plan and the wallet hold: `vmHoursRemaining` is in hours of a `default` machine, which costs
 * `vmHourDollars` an hour past the plan; `balanceDollars` is below zero while the wallet owes.
 */
export interface Billing {
  walletDollars: number;
  planHoursLeft: number;
  /** When the plan's included hours reset; null when boat names no date. */
  renewsAt: number | null;
  vmHourDollars: number;
}

export const wireLimits = z
  .object({
    teamId: z.string().optional(),
    canStart: z.boolean(),
    startBlockedReason: z.string().nullish(),
    starts: z.discriminatedUnion("unlimited", [
      z.object({ unlimited: z.literal(true) }),
      z.object({ unlimited: z.literal(false), minute: startWindow, hour: startWindow, day: startWindow }),
    ]),
    // All three are null or absent on unlimited accounts.
    wallet: z.object({ balanceDollars: z.number() }).nullish(),
    planIncluded: z.object({ vmHoursRemaining: z.number(), periodEnd: instant.nullable() }).nullish(),
    overagePrices: z.object({ vmHourDollars: z.number() }).nullish(),
  })
  .transform((limits) => ({
    wallet: limits.teamId === undefined
      ? { kind: "personal" as const }
      : { kind: "organization" as const, teamId: limits.teamId },
    starts: limits.starts,
    startsBlockedBy: limits.canStart ? null : (limits.startBlockedReason ?? "boat gave no reason"),
    // null on an unlimited account: no plan, wallet or price to count against.
    billing: limits.wallet && limits.planIncluded && limits.overagePrices
      ? ({
          walletDollars: limits.wallet.balanceDollars,
          planHoursLeft: limits.planIncluded.vmHoursRemaining,
          renewsAt: limits.planIncluded.periodEnd,
          vmHourDollars: limits.overagePrices.vmHourDollars,
        } satisfies Billing)
      : null,
  }));

/**
 * A boat environment as the plugin and the chip's RPC carry it: what of the account boat passes into
 * the sandboxes started in it.
 */
export const sandboxEnvironment = z.object({
  name: z.string(),
  /** boat keeps exactly one: a create that names no environment gets it. */
  isBoatDefault: z.boolean(),
  /** Safe for third parties: passes nothing, whatever `passes` says, except proxy placeholders. */
  withholdsAll: z.boolean(),
  /** With `withholdsAll`, the agents still sign in, through boat's AI proxy placeholders. */
  proxiesAi: z.boolean(),
  passes: z.object({ agents: z.boolean(), github: z.boolean(), secrets: z.boolean() }),
  /** The AI credential profile its sandboxes get; null: the sandbox owner's default profile. */
  profileId: z.string().nullable(),
});

/**
 * OAS `SandboxEnvironment`. Only the flags are read: zod drops `envContents` and `secretFiles`
 * (OAS: "Treat as sensitive") right here.
 */
const wireEnvironment = z
  .object({
    name: z.string(),
    isDefault: z.boolean(),
    safeForThirdParties: z.boolean(),
    proxyAiCredentials: z.boolean(),
    passAgentsCredentials: z.boolean(),
    passGithub: z.boolean(),
    passSecrets: z.boolean(),
    credentialProfileId: z.string().nullable(),
  })
  .transform((environment): SandboxEnvironment => ({
    name: environment.name,
    isBoatDefault: environment.isDefault,
    withholdsAll: environment.safeForThirdParties,
    proxiesAi: environment.proxyAiCredentials,
    passes: { agents: environment.passAgentsCredentials, github: environment.passGithub, secrets: environment.passSecrets },
    profileId: environment.credentialProfileId,
  }));

export const wireEnvironmentList = z
  .object({ environments: z.array(wireEnvironment) })
  .transform(({ environments }) => environments);

/** OAS `CredentialProfile`: which AI credentials boat holds, and whether its owner proxies them. */
const credentialProfile = z
  .object({
    id: z.string(),
    isDefault: z.boolean(),
    owner: z.object({ id: z.string(), aiProxyEnabled: z.boolean() }),
    connected: z.array(z.string()),
  })
  .transform((profile) => ({
    id: profile.id,
    isDefault: profile.isDefault,
    ownerId: profile.owner.id,
    proxyOn: profile.owner.aiProxyEnabled,
    connected: profile.connected,
  }));

export const wireCredentialProfileList = z
  .object({ profiles: z.array(credentialProfile) })
  .transform(({ profiles }) => profiles);

/**
 * The `ErrorEnvelope` every non-2xx JSON response carries. `error.details.retryable` marks a
 * `502 sandbox_direct_failed` whose command provably never ran.
 */
export const wireError = z.object({
  code: z.string(),
  message: z.string(),
  error: z.object({ details: z.object({ retryable: z.boolean().optional() }).nullish() }).optional(),
});

/** `cancelled` is terminal: boat reports it once with only id, state and error, then answers 404. */
const cancelledSandbox = z.object({ id: sandboxId, state: z.literal("cancelled") });

const presentSandbox = z.object({
  id: sandboxId,
  state: z.enum(["init", "provisioning", "provisioned", "cloning", "ready", "idle", "running", "archiving", "archived", "error"]),
  type: z.string(),
  labels: z.record(z.string(), z.string()),
  createdAt: instant,
  archiveAfter: instant.nullable(),
  stoppedAt: instant.nullable(),
  dataExpiredAt: instant.nullable(),
  error: z.string().nullable(),
  /** The last stop requested through the API, ever (OAS `StopOperation`); null if there never was one. */
  stop: z.object({ endedAt: instant.nullable() }).nullable(),
  /**
   * The account's logins (agent sign-ins, GitHub token, secrets) are on the sandbox. False for a no-env
   * sandbox, which still reports `environment: "base"`, so this is the field to read.
   */
  holdsCreatorLogins: z.boolean(),
  /**
   * The environment the sandbox runs (OAS: "what the sandbox actually holds"). Read it once the sandbox
   * runs: a create response can say null before then.
   */
  environment: z.string().nullable(),
});

export const wireSandbox = z.discriminatedUnion("state", [cancelledSandbox, presentSandbox]);

/** `GET /sandboxes/{id}` and `POST /sandboxes` both wrap the sandbox the same way. */
export const wireSandboxEnvelope = z.object({ sandbox: z.unknown() });
/** `nextCursor` is null on the last page. */
export const wireSandboxList = z.object({
  sandboxes: z.array(z.unknown()),
  pageInfo: z.object({ nextCursor: z.string().nullable() }),
});

/** Machine time this UTC calendar month at list price (OAS `cost`, `deletedCost`), counted from `since`, the 1st; boat also sends `seconds`. */
const monthCost = z.object({ since: instant, dollars: z.number() });

/**
 * One sandbox's meter in a list read with `include=cost`: its `cost`, and `billingMultiplier`, the
 * rate it uses machine time at (0.5 small, 1 default, 2 large, 50/9 xlarge).
 */
export const wireSandboxMeter = z.object({ cost: monthCost, billingMultiplier: z.number() });

/** A page of `GET /sandboxes?include=cost,deletedCost`: `deletedCost` is the deleted sandboxes' time, which no row carries. */
export const wireMeteredSandboxList = wireSandboxList.extend({ deletedCost: monthCost });

/**
 * `GET /api/boat/billing/wallet`, boat's undocumented account API behind its dashboard's Spending
 * chart: `status.spending.days` holds the last 30 UTC days, oldest first, today last, each split into
 * `machineDollars`, `startDollars` and `otherDollars`. Only machine time is read, deleted sandboxes'
 * included, the same as the meter `cost` counts.
 */
export const wireDailySpend = z
  .object({
    status: z.object({
      spending: z.object({ days: z.array(z.object({ day: z.iso.date(), machineDollars: z.number() })) }),
    }),
  })
  .transform(({ status }) => status.spending.days.map(({ day, machineDollars }): DaySpend => ({ day, dollars: machineDollars })));

/** A UTC day (`2026-11-10`) and the wallet's machine time that day, at list price. */
export interface DaySpend {
  day: string;
  dollars: number;
}

/**
 * One NDJSON line of `POST /sandboxes/{id}/commands` with `stream: true` (OAS `CommandStreamFrame`):
 * `started`, then output chunks, then exactly one `exit` or `error`. `exitCode` is null when a
 * signal ended the command; `retryable` on `error` means the command provably never ran.
 */
export const wireCommandFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started") }),
  z.object({ type: z.enum(["stdout", "stderr"]), data: z.string() }),
  z.object({ type: z.literal("exit"), exitCode: z.number().int().nullable() }),
  z.object({
    type: z.literal("error"),
    error: z.string().optional(),
    message: z.string().optional(),
    retryable: z.boolean().optional(),
  }),
]);

/** A boat saved snapshot as the plugin and the chip's RPC carry it: a template a thread sandbox can start from. */
export const savedSnapshot = z.object({
  name: z.string(),
  status: z.enum(["saving", "ready", "failed"]),
  /** boat's reason, only with `failed`. */
  error: z.string().nullable(),
  /** The size it was saved from, for display. */
  savedFrom: z.string().nullable(),
  /** ISO 8601. */
  savedAt: z.string(),
});

/** One saved snapshot of `GET /saved-snapshots` (OAS `SavedSnapshot`). */
const wireSavedSnapshot = z
  .object({
    name: z.string(),
    status: savedSnapshot.shape.status,
    error: z.string().optional(),
    type: z.string().optional(),
    createdAt: z.iso.datetime(),
  })
  .transform((snapshot): SavedSnapshot => ({
    name: snapshot.name,
    status: snapshot.status,
    error: snapshot.error ?? null,
    savedFrom: snapshot.type ?? null,
    savedAt: snapshot.createdAt,
  }));

/** Every saved snapshot on the account, in one page: the endpoint takes no `limit` or `cursor`. */
export const wireSavedSnapshotList = z.object({ snapshots: z.array(wireSavedSnapshot) }).transform(({ snapshots }) => snapshots);

/**
 * `GET /repos` (OAS `ReposResponse`), only who boat's GitHub App is installed for: boat's token is a
 * GitHub App user token, so it reads private repositories and pushes only under those owners.
 */
export const wireGithubApp = z
  .object({ installations: z.array(z.object({ accountLogin: z.string() })) })
  .transform(({ installations }) => ({ owners: installations.map((installation) => installation.accountLogin) }));

export type Account = z.output<typeof wireMe>;
export type Limits = z.output<typeof wireLimits>;
export type Wallet = Limits["wallet"];
export type PresentSandbox = z.output<typeof presentSandbox>;
export type SavedSnapshot = z.output<typeof savedSnapshot>;
export type SandboxEnvironment = z.output<typeof sandboxEnvironment>;
export type CredentialProfile = z.output<typeof credentialProfile>;
export type GithubApp = z.output<typeof wireGithubApp>;
