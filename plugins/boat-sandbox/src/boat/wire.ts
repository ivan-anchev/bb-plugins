// boat's JSON, parsed once. This is the only module that knows boat's field names;
// every other module trusts the types these schemas produce.
//
// GET /me and GET /limits were pinned against live boat API v1 responses on 2026-11-08:
// - /me: `user.id` is the account id (OpenAPI: "Your account id"; live it reads `sandbox_<32 hex>`),
//   `user.login`, `user.zeroDataRetention`.
// - /limits reads the wallet a create would bill (the key's active wallet). It carries `teamId`
//   only when that is an organization wallet. `starts.{minute,hour,day}` are `{limit, used, remaining}`,
//   all null when `starts.unlimited`. `canStart` / `startBlockedReason` say whether any start can run.
import { z } from "zod";

export const sandboxId = z.string().regex(/^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/).brand<"SandboxId">();
export const accountId = z.string().min(1).brand<"AccountId">();
const instant = z.iso.datetime().transform((value) => Date.parse(value));

export const wireMe = z
  .object({
    user: z.object({ id: accountId, login: z.string(), zeroDataRetention: z.boolean() }),
  })
  .transform(({ user }) => user);

const startWindow = z.object({ limit: z.number().int(), used: z.number().int() });

export const wireLimits = z
  .object({
    teamId: z.string().optional(),
    canStart: z.boolean(),
    startBlockedReason: z.string().nullish(),
    starts: z.discriminatedUnion("unlimited", [
      z.object({ unlimited: z.literal(true) }),
      z.object({ unlimited: z.literal(false), minute: startWindow, hour: startWindow, day: startWindow }),
    ]),
  })
  .transform((limits) => ({
    wallet: limits.teamId === undefined
      ? { kind: "personal" as const }
      : { kind: "organization" as const, teamId: limits.teamId },
    starts: limits.starts,
    startsBlockedBy: limits.canStart ? null : (limits.startBlockedReason ?? "boat gave no reason"),
  }));

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
   * sandbox, which still reports `environment: "base"` (live, 2026-11-09), so this is the field to read.
   */
  holdsCreatorLogins: z.boolean(),
});

export const wireSandbox = z.discriminatedUnion("state", [cancelledSandbox, presentSandbox]);

/** `GET /sandboxes/{id}` and `POST /sandboxes` both wrap the sandbox the same way. */
export const wireSandboxEnvelope = z.object({ sandbox: z.unknown() });
/** `nextCursor` is null on the last page. */
export const wireSandboxList = z.object({
  sandboxes: z.array(z.unknown()),
  pageInfo: z.object({ nextCursor: z.string().nullable() }),
});

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

/**
 * One saved snapshot of `GET /saved-snapshots` (OAS `SavedSnapshot`): a template a thread sandbox can
 * start from. `error` comes only with `failed`; `type` is the size it was saved from, for display.
 */
const savedSnapshot = z
  .object({
    name: z.string(),
    status: z.enum(["saving", "ready", "failed"]),
    error: z.string().optional(),
    type: z.string().optional(),
    createdAt: z.iso.datetime(),
  })
  .transform((snapshot) => ({
    name: snapshot.name,
    status: snapshot.status,
    error: snapshot.error ?? null,
    savedFrom: snapshot.type ?? null,
    savedAt: snapshot.createdAt,
  }));

/** Every saved snapshot on the account, in one page: the endpoint takes no `limit` or `cursor`. */
export const wireSavedSnapshotList = z.object({ snapshots: z.array(savedSnapshot) }).transform(({ snapshots }) => snapshots);

export type Account = z.output<typeof wireMe>;
export type Limits = z.output<typeof wireLimits>;
export type Wallet = Limits["wallet"];
export type PresentSandbox = z.output<typeof presentSandbox>;
export type SavedSnapshot = z.output<typeof savedSnapshot>;
