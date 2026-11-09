// Stopping and waking one boat sandbox, for bb's suspend and resume. A stop keeps the disk, so the
// sandbox id is all bb needs to get the same machine back.
import { setTimeout as sleep } from "node:timers/promises";
import type { BoatClient } from "./boat/client.ts";
import { isAwake, type Sandbox, type SandboxId } from "./boat/sandbox.ts";
import type { StartGate } from "./boat/start-gate.ts";

/** A fresh or resumed sandbox is up in about 1.5 s (spike Q1, Q5). */
const START_PATIENCE_MS = 5 * 60_000;
/** A stop takes about 14 s (spike Q5); boat retries one whose disk save fails. */
const STOP_PATIENCE_MS = 10 * 60_000;
/** boat keeps the stopped machine for 10 minutes, and taking it back is not a start (spike Q6). */
const KEPT_MACHINE_MS = 10 * 60_000;
const POLL_MS = 2_000;

/** Stops the sandbox unless it is already down, and waits until boat has saved its disk. */
export async function stopSandbox(client: BoatClient, id: SandboxId, signal: AbortSignal): Promise<void> {
  const sandbox = await client.get(id, signal);
  if (sandbox !== null && isAwake(sandbox)) await client.stop(id, signal);
  await waitUntilStopped(client, id, signal);
}

/** Gets the same sandbox running again on its saved disk; running already is fine. */
export async function wakeSandbox(client: BoatClient, gate: StartGate, id: SandboxId, signal: AbortSignal): Promise<void> {
  const found = await client.get(id, signal);
  const sandbox = found?.phase === "stopping" ? await waitUntilStopped(client, id, signal) : found;
  if (sandbox === null) throw new Error(`boat sandbox ${id} no longer exists; remove this machine.`);
  if (sandbox.dataExpired) throw new Error(`boat deleted the disk of sandbox ${id} after its stopped-disk retention; remove this machine.`);
  if (!isAwake(sandbox)) await resumeStopped(client, gate, sandbox, signal);
  await waitUntilRunning(client, id, signal);
}

export async function waitUntilRunning(client: BoatClient, id: SandboxId, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + START_PATIENCE_MS;
  for (;;) {
    const sandbox = await client.get(id, signal);
    if (sandbox === null) throw new Error(`boat deleted sandbox ${id} while it was starting.`);
    if (sandbox.phase === "running") return;
    if (sandbox.phase !== "starting")
      throw new Error(`boat sandbox ${id} is ${sandbox.phase} instead of starting${sandbox.stopNote ? ` (${sandbox.stopNote})` : ""}.`);
    if (Date.now() > deadline) throw new Error(`boat sandbox ${id} did not start within ${START_PATIENCE_MS / 60_000} minutes.`);
    await sleep(POLL_MS, undefined, { signal });
  }
}

/**
 * Taking back the kept machine is not a start, so it runs past the gate's window; boat still has the
 * last word at the edge of the window, and a 429 it sends then holds back later starts.
 */
async function resumeStopped(client: BoatClient, gate: StartGate, sandbox: Sandbox, signal: AbortSignal): Promise<void> {
  const resume = () => client.resume(sandbox.id, signal);
  const kept = sandbox.stoppedAt !== null && Date.now() - sandbox.stoppedAt < KEPT_MACHINE_MS;
  await (kept ? gate.startUncounted(resume, signal) : gate.start(resume, signal));
}

/** The sandbox once it is stopped or failed; null once boat no longer has it. */
async function waitUntilStopped(client: BoatClient, id: SandboxId, signal: AbortSignal): Promise<Sandbox | null> {
  const deadline = Date.now() + STOP_PATIENCE_MS;
  for (;;) {
    const sandbox = await client.get(id, signal);
    if (sandbox === null || (!isAwake(sandbox) && sandbox.phase !== "stopping")) return sandbox;
    if (Date.now() > deadline)
      throw new Error(`boat sandbox ${id} is still ${sandbox.phase} after ${STOP_PATIENCE_MS / 60_000} minutes; boat retries a stop until it has saved the disk.`);
    await sleep(POLL_MS, undefined, { signal });
  }
}
