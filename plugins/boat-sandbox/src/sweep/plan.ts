// The minutely sweep's decisions, pure: from what bb and boat each say now, what to do this minute:
// idle stops, the auto-stop lease, drift between bb and boat, and leaked sandboxes.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isAwake, type Sandbox, type SandboxId } from "../boat/sandbox.ts";

type Host = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];
export type HostPhase = Host["lifecycle"]["phase"];

/** One boat machine as bb sees it. */
export interface HostView {
  hostId: string;
  phase: HostPhase;
  sandboxId: SandboxId;
  /** A thread on it, hidden ones included, is starting or running a turn. */
  busy: boolean;
  /** From the idle clock; null when nothing was recorded yet. */
  lastActiveAt: number | null;
}

export interface SweepInput {
  hosts: readonly HostView[];
  /**
   * Every machine sandbox this server owns, in any state, plus any machine's sandbox the owner listing
   * missed. A machine's sandbox absent here no longer exists on boat.
   */
  sandboxes: ReadonlyMap<SandboxId, Sandbox>;
}

export interface SweepPolicy {
  now: number;
  /** null: never suspend a machine for being idle. */
  idleMs: number | null;
}

export type SweepAction =
  | { kind: "mark-active"; hostId: string }
  | { kind: "suspend-idle"; hostId: string }
  | { kind: "renew-lease"; sandboxId: SandboxId }
  /** The machine is active but its sandbox is down or gone: core suspends it, and the provider's stop finds nothing to stop. */
  | { kind: "record-stopped"; hostId: string; why: string }
  /** The machine is suspended but its sandbox runs: core's reconcile runs the provider's suspend again. */
  | { kind: "stop-again"; hostId: string }
  /** An owned sandbox no machine uses: stopped, never deleted. */
  | { kind: "stop-orphan"; sandboxId: SandboxId };

/** Renewing under an hour keeps boat's deadline at least ~59 minutes away while bb runs. */
const RENEW_BELOW_MS = 60 * 60_000;
/** A create checkpoints its sandbox within seconds, so a quarter of an hour is far past any create still in flight. */
const ORPHAN_AFTER_MS = 15 * 60_000;

export function planSweep(input: SweepInput, policy: SweepPolicy): SweepAction[] {
  const referenced = new Set(input.hosts.map((host) => host.sandboxId));
  const orphans = [...input.sandboxes.values()].filter((sandbox) => !referenced.has(sandbox.id));
  return [
    ...input.hosts.flatMap((host) => planHost(host, input.sandboxes.get(host.sandboxId) ?? null, policy)),
    ...orphans.flatMap((sandbox) => planOrphan(sandbox, policy)),
  ];
}

function planHost(host: HostView, sandbox: Sandbox | null, policy: SweepPolicy): SweepAction[] {
  switch (host.phase) {
    case "active":
      return planActive(host, sandbox, policy);
    case "suspended":
      return planSuspended(host, sandbox);
    // Core is mid-operation. Compute runs until boat confirms it stopped, and a suspend can fail and leave it running.
    case "creating":
    case "resuming":
    case "suspending":
      return sandbox !== null && isAwake(sandbox) ? leaseIfDue(sandbox, policy) : [];
    // Core is removing it or has: nothing runs on it that needs the lease.
    case "removing":
    case "destroyed":
      return [];
    default:
      return neutral(host.phase);
  }
}

/**
 * Down or gone under an active machine means boat stopped or lost it outside bb (its auto-stop after
 * bb was away, an empty wallet, an error, a `boat delete`), so bb records the machine as suspended.
 * Otherwise the lease is renewed when due, and before any suspend: core can refuse the suspend
 * (machine_busy) or fail to stop the sandbox, which then keeps running on the lease it has.
 */
function planActive(host: HostView, sandbox: Sandbox | null, policy: SweepPolicy): SweepAction[] {
  if (sandbox === null) return [recordStopped(host, `boat sandbox ${host.sandboxId} no longer exists`)];
  if (!isAwake(sandbox)) return [recordStopped(host, `boat sandbox ${sandbox.id} is ${describePhase(sandbox)}`)];
  if (isIdle(host, policy)) return [...leaseIfDue(sandbox, policy), { kind: "suspend-idle", hostId: host.hostId }];
  // A machine never seen before starts its idle clock now rather than counting as idle forever.
  const markActive: SweepAction[] = host.busy || host.lastActiveAt === null ? [{ kind: "mark-active", hostId: host.hostId }] : [];
  return [...markActive, ...leaseIfDue(sandbox, policy)];
}

/**
 * Awake under a suspended machine means someone resumed it outside bb, or a stop never landed. A gone
 * one is left to the follow-up, which fails with "remove this machine".
 */
function planSuspended(host: HostView, sandbox: Sandbox | null): SweepAction[] {
  return sandbox !== null && isAwake(sandbox) ? [{ kind: "stop-again", hostId: host.hostId }] : [];
}

/**
 * An owned sandbox no machine references is stopped, never deleted: a stop ends the bill and keeps the
 * disk, so a wrong call costs nothing, while a wrong delete loses someone's work.
 */
function planOrphan(sandbox: Sandbox, { now }: SweepPolicy): SweepAction[] {
  return isAwake(sandbox) && now - sandbox.createdAt >= ORPHAN_AFTER_MS ? [{ kind: "stop-orphan", sandboxId: sandbox.id }] : [];
}

const isIdle = ({ busy, lastActiveAt }: HostView, { now, idleMs }: SweepPolicy): boolean =>
  !busy && lastActiveAt !== null && idleMs !== null && now - lastActiveAt >= idleMs;

function leaseIfDue(sandbox: Sandbox, { now }: SweepPolicy): SweepAction[] {
  return sandbox.archiveAfter !== null && sandbox.archiveAfter - now < RENEW_BELOW_MS
    ? [{ kind: "renew-lease", sandboxId: sandbox.id }]
    : [];
}

const recordStopped = ({ hostId }: HostView, why: string): SweepAction => ({ kind: "record-stopped", hostId, why });

const describePhase = ({ phase, stopNote }: Sandbox): string => (stopNote === null ? phase : `${phase} (${stopNote})`);

/** A phase a newer bb adds is a compile error here, and nothing at run time. */
function neutral(phase: never): SweepAction[] {
  void phase;
  return [];
}
