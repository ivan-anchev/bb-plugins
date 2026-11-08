// The boat machine provider: core asks it for a sandbox, enrolls the daemon through its command
// channel, suspends it as a boat stop, resumes the same sandbox, and deletes it when the machine goes.
import type { MachineBootstrapRequest, PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession, Configuration } from "./boat/access.ts";
import { isNotFound, type BoatClient } from "./boat/client.ts";
import type { Sandbox, SandboxId } from "./boat/sandbox.ts";
import type { StartGate } from "./boat/start-gate.ts";
import { boatExecutor } from "./executor.ts";
import type { IdleClock } from "./idle-clock.ts";
import { machineInputs, resolveLaunch, type Launch } from "./launch.ts";
import { machineLabels, parseResource, sandboxName, type BoatResource } from "./ownership.ts";
import { describeProblems } from "./problem.ts";
import { stopSandbox, waitUntilRunning, wakeSandbox } from "./sandbox-power.ts";

export const PROVIDER_ID = "boat-sandbox";
/**
 * The auto-stop every sandbox carries: the longest a trial allows. The sweep renews it while bb
 * runs, so boat stops a sandbox only once bb has been gone for about an hour.
 */
export const LEASE_TTL_SECONDS = 7200;

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

  return {
    id: PROVIDER_ID,
    displayName: "boat Sandbox",
    description: "An on-demand boat.dev VM for one thread. It stops when idle and resumes on the same disk.",
    icon: "./boat.svg",
    // Core removes the machine once no live thread or launch needs it, as for Modal.
    ephemeral: true,
    inputs: machineInputs,
    availability: async () => toAvailability(await access.configuration()),

    async create({ inputs, key, attempt, checkpoint, report, signal }) {
      try {
        const session = await access.session(signal);
        const launch = resolveLaunch(inputs, session.settings.defaultPreset);
        report.step(`Creating ${launch.preset === "xlarge" ? "an" : "a"} ${launch.preset} boat sandbox`);
        const sandbox = await findOrStartSandbox({ session, gate, ownerId, launch, key, attempt, signal });
        const resource: BoatResource = { sandboxId: sandbox.id, key, accountId: session.facts.account.id };
        // Before bootstrap, so a restart finds and deletes this sandbox instead of leaking it.
        await checkpoint(resource);
        await waitUntilRunning(session.client, sandbox.id, signal);
        const { hostId } = await bootstrap({ key, executor: boatExecutor(session.client, sandbox.id), report, signal });
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
      const enrolled = await bootstrap({ key: owned.key, executor: boatExecutor(client, owned.sandboxId), report, signal });
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

  const body = { name: sandboxName(key), type: launch.preset, labels, ttlSeconds: LEASE_TTL_SECONDS, noEnv: true } as const;
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

// boat's and the start gate's messages are written for people; core shows them on the thread.
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
