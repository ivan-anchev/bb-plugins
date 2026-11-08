// The boat machine provider: core asks it for a sandbox, enrolls the daemon through its command
// channel, and asks it to delete the sandbox when the machine goes.
import { setTimeout as sleep } from "node:timers/promises";
import type { MachineBootstrapRequest, PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession, Configuration } from "./boat/access.ts";
import { isNotFound, type BoatClient } from "./boat/client.ts";
import type { Sandbox, SandboxId } from "./boat/sandbox.ts";
import type { StartGate } from "./boat/start-gate.ts";
import { boatExecutor } from "./executor.ts";
import { machineInputs, resolveLaunch, type Launch } from "./launch.ts";
import { machineLabels, parseResource, sandboxName, type BoatResource } from "./ownership.ts";
import { describeProblems } from "./problem.ts";

export const PROVIDER_ID = "boat-sandbox";
/** The longest auto-stop a trial allows: boat stops a sandbox bb forgot about after this. */
const LEASE_TTL_SECONDS = 7200;
/** A fresh sandbox is up in about 1.5 s (spike Q1). */
const START_PATIENCE_MS = 5 * 60_000;
const START_POLL_MS = 2_000;

interface ProviderDeps {
  access: BoatAccess;
  gate: StartGate;
  ownerId: string;
  /** Core's enrollment over the plugin's command channel. */
  bootstrap(request: MachineBootstrapRequest): Promise<{ hostId: string }>;
}

export function boatMachineProvider(deps: ProviderDeps): PluginMachineProviderDeclaration<typeof machineInputs> {
  const { access, gate, ownerId, bootstrap } = deps;
  return {
    id: PROVIDER_ID,
    displayName: "boat Sandbox",
    description: "An on-demand boat.dev VM for one thread, deleted when the thread no longer needs it.",
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
        await bootstrap({ key, executor: boatExecutor(session.client, sandbox.id), report, signal });
        return { status: "created", name: `boat ${sandbox.id}`, resource };
      } catch (error) {
        signal.throwIfAborted();
        return { status: "failed", message: messageOf(error) };
      }
    },

    async remove({ resource, signal }) {
      try {
        const { sandboxId, accountId } = parseResource(resource);
        const session = await access.session(signal);
        if (session.facts.account.id !== accountId)
          throw new Error(
            `Sandbox ${sandboxId} belongs to boat account ${accountId}, but the API key in Settings → boat Sandbox is for ` +
              `${session.facts.account.id}. Put that account's key back to delete it.`,
          );
        await deleteSandbox(session.client, sandboxId, signal);
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

async function waitUntilRunning(client: BoatClient, id: SandboxId, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + START_PATIENCE_MS;
  for (;;) {
    const sandbox = await client.get(id, signal);
    if (sandbox === null) throw new Error(`boat deleted sandbox ${id} while it was starting.`);
    if (sandbox.phase === "running") return;
    if (sandbox.phase !== "starting")
      throw new Error(`boat sandbox ${id} is ${sandbox.phase} instead of starting${sandbox.stopNote ? ` (${sandbox.stopNote})` : ""}.`);
    if (Date.now() > deadline) throw new Error(`boat sandbox ${id} did not start within ${START_PATIENCE_MS / 60_000} minutes.`);
    await sleep(START_POLL_MS, undefined, { signal });
  }
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
