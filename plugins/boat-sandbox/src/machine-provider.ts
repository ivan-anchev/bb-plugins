// The boat machine provider: core asks it for a sandbox, enrolls the daemon through its command
// channel, suspends it as a boat stop, resumes the same sandbox, and deletes it when the machine goes.
import type { MachineBootstrapRequest, PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession, Configuration } from "./boat/access.ts";
import { isNotFound, type BoatClient, type CreateSandboxBody } from "./boat/client.ts";
import type { Sandbox, SandboxId } from "./boat/sandbox.ts";
import type { StartGate } from "./boat/start-gate.ts";
import type { SandboxEnvironment } from "./boat/wire.ts";
import { resolveOnBoat } from "./catalog/read.ts";
import { prepareDaemon } from "./daemon-setup.ts";
import { boatExecutor } from "./executor.ts";
import type { IdleClock } from "./idle-clock.ts";
import { resetInstance } from "./instance-reset.ts";
import { describeLaunch, machineInputs, type Launch } from "./launch.ts";
import { machineLabels, parseResource, sandboxName, type BoatResource } from "./ownership.ts";
import { describeProblems, messageOf } from "./problem.ts";
import { LEASE_TTL_SECONDS, stopSandbox, waitUntilRunning, wakeSandbox } from "./sandbox-power.ts";

export const PROVIDER_ID = "boat-sandbox";

/** validate gets no caller signal; it reads /me, /limits, /saved-snapshots and /environments. */
const VALIDATE_PATIENCE_MS = 15_000;

interface ProviderDeps {
  access: BoatAccess;
  gate: StartGate;
  ownerId: string;
  idle: Pick<IdleClock, "touch">;
  /** Core's enrollment over the plugin's command channel. */
  bootstrap(request: MachineBootstrapRequest): Promise<{ hostId: string }>;
}

export function boatMachineProvider(deps: ProviderDeps): PluginMachineProviderDeclaration<typeof machineInputs> {
  const { access, gate, ownerId, idle, bootstrap } = deps;

  /** The session for a sandbox this server made, refusing a key for another boat account. */
  async function sessionFor({ sandboxId, accountId }: BoatResource, signal: AbortSignal): Promise<BoatSession> {
    const session = await access.session(signal);
    if (session.facts.account.id !== accountId)
      throw new Error(
        `Sandbox ${sandboxId} belongs to boat account ${accountId}, but the API key in Settings → boat Sandbox is for ` +
          `${session.facts.account.id}. Put that account's key back to manage it.`,
      );
    return session;
  }

  /** Core's enrollment, with the daemon it starts given boat's sign-ins and GitHub token. */
  async function enroll(client: BoatClient, sandboxId: SandboxId, key: string, report: MachineBootstrapRequest["report"], signal: AbortSignal) {
    await prepareDaemon(client, sandboxId, signal);
    return bootstrap({ key, executor: boatExecutor(client, sandboxId), report, signal });
  }

  return {
    id: PROVIDER_ID,
    displayName: "boat Sandbox",
    description: "An on-demand boat.dev VM for one thread, from boat's stock image or a saved snapshot. It stops when idle and resumes on the same disk.",
    icon: "./boat.svg",
    // Core removes the machine once no live thread or launch needs it, as for Modal.
    ephemeral: true,
    inputs: machineInputs,
    availability: async () => toAvailability(await access.configuration()),

    // Before core records a thread or a machine. Asks boat, because boat owns the template and environment names.
    async validate({ inputs }) {
      try {
        const signal = AbortSignal.timeout(VALIDATE_PATIENCE_MS);
        const resolution = await resolveOnBoat(await access.session(signal), inputs, signal);
        return resolution.ok ? { action: "accept" } : { action: "refuse", message: resolution.message };
      } catch (error) {
        // One path for every failure: if boat cannot answer now, the create could not run either.
        return { action: "refuse", message: messageOf(error) };
      }
    },

    async create({ inputs, key, attempt, checkpoint, report, signal }) {
      try {
        const session = await access.session(signal);
        // Again here: a template or environment may be gone, or a setting changed, since validate.
        const resolution = await resolveOnBoat(session, inputs, signal);
        if (!resolution.ok) return { status: "failed", message: resolution.message };
        const { launch, environment } = resolution;
        report.step(`Creating ${describeLaunch(launch)}`);
        const sandbox = await findOrStartSandbox({ session, gate, ownerId, launch, key, attempt, signal });
        const resource: BoatResource = { sandboxId: sandbox.id, key, accountId: session.facts.account.id };
        // Before anything that can fail, so core's cleanup deletes this sandbox instead of leaking it.
        await checkpoint(resource);
        expectEnvironment(await waitUntilRunning(session.client, sandbox.id, signal), launch, environment);
        // Create only, never resume: a template may carry another machine's bb identity.
        const removed = await resetInstance(session.client, sandbox.id, key, signal);
        // A log line, not a step: core samples the current step once a second, so a short one can vanish.
        if (removed.length > 0)
          report.log(`Removed the bb machine state template ${launch.template} carried from another machine: ${removed.join(", ")}`);
        const { hostId } = await enroll(session.client, sandbox.id, key, report, signal);
        await idle.touch(hostId);
        return { status: "created", name: `boat ${sandbox.id}`, resource };
      } catch (error) {
        signal.throwIfAborted();
        return { status: "failed", message: messageOf(error) };
      }
    },

    // Core drains the machine's turns and terminals and stops its daemon before calling this.
    async suspend({ resource, report, signal }) {
      const owned = parseResource(resource);
      const { client } = await sessionFor(owned, signal);
      report.step(`Stopping boat sandbox ${owned.sandboxId}; boat saves its disk`);
      await stopSandbox(client, owned.sandboxId, signal);
      // The sandbox id is the whole recovery record and does not change, so there is nothing to checkpoint.
      return { resource };
    },

    // Core calls this for a follow-up to a suspended thread, or `bb machine resume`.
    async resume({ hostId, resource, checkpoint, report, signal }) {
      const owned = parseResource(resource);
      const { client } = await sessionFor(owned, signal);
      report.step(`Resuming boat sandbox ${owned.sandboxId}`);
      await wakeSandbox(client, gate, owned.sandboxId, signal);
      // Unchanged, but core refuses it if this resume no longer owns the machine.
      await checkpoint(resource);
      // No resetInstance: the disk is this machine's own.
      const enrolled = await enroll(client, owned.sandboxId, owned.key, report, signal);
      if (enrolled.hostId !== hostId)
        throw new Error(`boat sandbox ${owned.sandboxId} enrolled as ${enrolled.hostId}, not as machine ${hostId}.`);
      await idle.touch(hostId);
      return { resource };
    },

    async remove({ resource, signal }) {
      try {
        const owned = parseResource(resource);
        const { client } = await sessionFor(owned, signal);
        await deleteSandbox(client, owned.sandboxId, signal);
        return { status: "removed" };
      } catch (error) {
        signal.throwIfAborted();
        return { status: "failed", message: messageOf(error) };
      }
    },

    // Core calls this when a create stopped before its checkpoint: whatever boat made for `key` goes.
    async reconcileCleanup({ key, signal }) {
      try {
        const { client } = await access.session(signal);
        const labels = machineLabels(ownerId, key);
        for (const sandbox of await client.list(labels, signal)) await deleteSandbox(client, sandbox.id, signal);
        const left = await client.list(labels, signal);
        if (left.length === 0) return { status: "removed" };
        return { status: "failed", message: `boat still lists ${left.map((sandbox) => sandbox.id).join(", ")}.` };
      } catch (error) {
        signal.throwIfAborted();
        return { status: "failed", message: messageOf(error) };
      }
    },
  };
}

/**
 * Checks what boat attached, once the sandbox runs (a create response can say `environment: null` before
 * then): the environment must be the launch's, and a sandbox in an environment that passes logins must
 * hold them. The second check is the one that catches no-env: a `from` create inherits the no-env of the
 * snapshot's source sandbox even when it names an environment, and then reports that environment with
 * `holdsCreatorLogins: false` (live, 2026-11-09). Its first turn would only say `/login`.
 */
function expectEnvironment(sandbox: Sandbox, launch: Launch, environment: SandboxEnvironment): void {
  const source = launch.template === null ? "" : ` from template ${launch.template}`;
  if (sandbox.environment !== launch.environment)
    throw new Error(
      `boat started sandbox ${sandbox.id}${source} without environment ${launch.environment} ` +
        `(it holds ${sandbox.environment ?? "none"}), so it would not get that environment's sign-ins.`,
    );
  if (!sandbox.holdsLogins && passesLogins(environment))
    throw new Error(
      `boat started sandbox ${sandbox.id}${source} as a no-env sandbox, so it would get no sign-ins. ` +
        "A template saved from a no-env sandbox makes only no-env sandboxes; save the template from a sandbox in an environment.",
    );
}

/** boat holds none of the creator's logins on a sandbox whose environment passes nothing (OAS `Sandbox.visibility`). */
const passesLogins = ({ withholdsAll, passes }: SandboxEnvironment): boolean =>
  !withholdsAll && (passes.agents || passes.github || passes.secrets);

const toAvailability = (configuration: Configuration) =>
  configuration.status === "available"
    ? { status: configuration.status }
    : { status: configuration.status, message: describeProblems(configuration.problems) };

interface StartRequest {
  session: BoatSession;
  gate: StartGate;
  ownerId: string;
  launch: Launch;
  key: string;
  attempt: number;
  signal: AbortSignal;
}

/**
 * Adopts the sandbox an earlier run of this create made (its labels carry the key), else starts one.
 * The Idempotency-Key is per attempt, so a retried POST of one attempt never makes a second sandbox.
 */
async function findOrStartSandbox({ session, gate, ownerId, launch, key, attempt, signal }: StartRequest): Promise<Sandbox> {
  const labels = machineLabels(ownerId, key);
  const [existing] = await session.client.list(labels, signal);
  if (existing !== undefined) return existing;

  // Never `noEnv`: the launch's environment signs the agents in, as the user set it up on boat.
  const body: CreateSandboxBody = {
    name: sandboxName(key),
    type: launch.preset,
    labels,
    ttlSeconds: LEASE_TTL_SECONDS,
    environment: launch.environment,
    ...(launch.template === null ? {} : { from: launch.template }),
  };
  const idempotencyKey = `bb:${ownerId}:${key}:${attempt}`;
  return gate.start(
    (retry) => session.client.create(body, retry ? `${idempotencyKey}:after-limit` : idempotencyKey, signal),
    signal,
  );
}

/** Gone already counts as deleted. */
async function deleteSandbox(client: BoatClient, id: SandboxId, signal: AbortSignal): Promise<void> {
  try {
    await client.remove(id, signal);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
