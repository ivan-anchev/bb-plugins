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
const accountId = z.string().min(1).brand<"AccountId">();
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

/** The `ErrorEnvelope` every non-2xx JSON response carries. */
export const wireError = z.object({ code: z.string(), message: z.string() });

/** `cancelled` is terminal: boat reports it once with only id, state and error, then answers 404. */
const cancelledSandbox = z.object({ id: sandboxId, state: z.literal("cancelled") });

const presentSandbox = z.object({
  id: sandboxId,
  state: z.enum(["init", "provisioning", "provisioned", "cloning", "ready", "idle", "running", "archiving", "archived", "error"]),
  labels: z.record(z.string(), z.string()),
  createdAt: instant,
  archiveAfter: instant.nullable(),
  stoppedAt: instant.nullable(),
  dataExpiredAt: instant.nullable(),
  error: z.string().nullable(),
  stop: z.object({}).nullable(),
});

export const wireSandbox = z.discriminatedUnion("state", [cancelledSandbox, presentSandbox]);

export type Account = z.output<typeof wireMe>;
export type Limits = z.output<typeof wireLimits>;
export type Wallet = Limits["wallet"];
export type PresentSandbox = z.output<typeof presentSandbox>;
