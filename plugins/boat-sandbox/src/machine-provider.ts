import type { MachineBootstrapRequest, PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession, Configuration } from "./boat/access.ts";
import { isNotFound, type BoatClient, type CreateSandboxBody } from "./boat/client.ts";
import type { Sandbox, SandboxId } from "./boat/sandbox.ts";
import type { StartGate } from "./boat/start-gate.ts";
import type { SandboxEnvironment } from "./boat/wire.ts";
import { resolveOnBoat } from "./catalog/read.ts";
import { PROVIDER_ID } from "./contract.ts";
import { prepareDaemon } from "./daemon-setup.ts";
import { boatExecutor } from "./executor.ts";
import type { IdleClock } from "./idle-clock.ts";
import { resetInstance } from "./instance-reset.ts";
import { describeLaunch, machineInputs, type Launch } from "./launch.ts";
import { machineLabels, parseResource, sandboxName, type BoatResource } from "./ownership.ts";
import { describeProblems, messageOf } from "./problem.ts";
import { LEASE_TTL_SECONDS, stopSandbox, waitUntilRunning, wakeSandbox } from "./sandbox-power.ts";

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

  async function sessionFor({ sandboxId, accountId }: BoatResource, signal: AbortSignal): Promise<BoatSession> {
    const session = await access.session(signal);
    if (session.facts.account.id !== accountId)
      throw new Error(
        `Sandbox ${sandboxId} belongs to boat account ${accountId}, but the API key in Settings → boat Sandbox is for ` +
          `${session.facts.account.id}. Put that account's key back to manage it.`,
      );
    return session;
  }

  async function enroll(client: BoatClient, sandboxId: SandboxId, key: string, report: MachineBootstrapRequest["report"], signal: AbortSignal) {
    await prepareDaemon(client, sandboxId, signal);
    return bootstrap({ key, executor: boatExecutor(client, sandboxId), report, signal });
  }

  return {
    id: PROVIDER_ID,
    displayName: "boat Sandbox",
    description: "An on-demand boat.dev VM for one thread, from boat's stock image or a saved snapshot. It stops when idle and resumes on the same disk.",
    icon: "./boat.svg",
    ephemeral: true,
    inputs: machineInputs,
    availability: async () => toAvailability(await access.configuration()),

    async validate({ inputs }) {
      try {
        const signal = AbortSignal.timeout(VALIDATE_PATIENCE_MS);
        const resolution = await resolveOnBoat(await access.session(signal), inputs, signal);
        return resolution.ok ? { action: "accept" } : { action: "refuse", message: resolution.message };
      } catch (error) {
        return { action: "refuse", message: messageOf(error) };
      }
    },

    async create({ inputs, key, attempt, checkpoint, report, signal }) {
      try {
        const session = await access.session(signal);
        const resolution = await resolveOnBoat(session, inputs, signal);
        if (!resolution.ok) return { status: "failed", message: resolution.message };
        const { launch, environment } = resolution;
        report.step(`Creating ${describeLaunch(launch)}`);
        const sandbox = await findOrStartSandbox({ session, gate, ownerId, launch, key, attempt, signal });
        const resource: BoatResource = { sandboxId: sandbox.id, key, accountId: session.facts.account.id };
        await checkpoint(resource);
        expectEnvironment(await waitUntilRunning(session.client, sandbox.id, signal), launch, environment);
        const removed = await resetInstance(session.client, sandbox.id, key, signal);
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

    async suspend({ resource, report, signal }) {
      const owned = parseResource(resource);
      const { client } = await sessionFor(owned, signal);
      report.step(`Stopping boat sandbox ${owned.sandboxId}; boat saves its disk`);
      await stopSandbox(client, owned.sandboxId, signal);
      return { resource };
    },

    async resume({ hostId, resource, checkpoint, report, signal }) {
      const owned = parseResource(resource);
      const { client } = await sessionFor(owned, signal);
      report.step(`Resuming boat sandbox ${owned.sandboxId}`);
      await wakeSandbox(client, gate, owned.sandboxId, signal);
      await checkpoint(resource);
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

const passesLogins = ({ withholdsAll, passes }: SandboxEnvironment): boolean =>
  !withholdsAll && (passes.agents || passes.github || passes.secrets);

type Availability = Awaited<ReturnType<NonNullable<PluginMachineProviderDeclaration["availability"]>>>;

const toAvailability = (configuration: Configuration): Availability =>
  configuration.status === "available"
    ? { status: "available" }
    : {
        status: configuration.status === "setup-required" ? "setup-required" : "unavailable",
        message: describeProblems(configuration.problems),
      };

interface StartRequest {
  session: BoatSession;
  gate: StartGate;
  ownerId: string;
  launch: Launch;
  key: string;
  attempt: number;
  signal: AbortSignal;
}

async function findOrStartSandbox({ session, gate, ownerId, launch, key, attempt, signal }: StartRequest): Promise<Sandbox> {
  const labels = machineLabels(ownerId, key);
  const [existing] = await session.client.list(labels, signal);
  if (existing !== undefined) return existing;

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

async function deleteSandbox(client: BoatClient, id: SandboxId, signal: AbortSignal): Promise<void> {
  try {
    await client.remove(id, signal);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
