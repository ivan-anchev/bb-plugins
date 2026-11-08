// The minutely sweep's decisions, pure: from what bb and boat each say now, what to do this minute.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isAwake, type Sandbox, type SandboxId } from "../boat/sandbox.ts";

type Host = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];
export type HostPhase = Host["lifecycle"]["phase"];

/** One boat machine as bb sees it. */
export interface HostView {
  hostId: string;
  phase: HostPhase;
  sandboxId: SandboxId;
  /** A thread on it is pending, starting, running a turn or stopping one. */
  busy: boolean;
  /** From the idle clock; null when nothing was recorded yet. */
  lastActiveAt: number | null;
}

export interface SweepInput {
  hosts: readonly HostView[];
  /** This server's sandboxes, as boat lists them. */
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
  | { kind: "renew-lease"; sandboxId: SandboxId };

/** Renewing under an hour keeps boat's deadline at least ~59 minutes away while bb runs. */
const RENEW_BELOW_MS = 60 * 60_000;

export function planSweep({ hosts, sandboxes }: SweepInput, policy: SweepPolicy): SweepAction[] {
  return hosts.flatMap((host) => planHost(host, sandboxes.get(host.sandboxId) ?? null, policy));
}

function planHost(host: HostView, sandbox: Sandbox | null, policy: SweepPolicy): SweepAction[] {
  const awake = sandbox !== null && isAwake(sandbox);
  switch (host.phase) {
    case "active":
      // Not awake under an active machine means boat stopped or lost it outside bb, which this sweep leaves alone.
      return awake ? planActive(host, sandbox, policy) : [];
    // Compute runs until boat confirms it stopped, and a suspend can fail and leave it running.
    case "creating":
    case "resuming":
    case "suspending":
      return awake ? leaseIfDue(sandbox, policy) : [];
    // Core has it down already or is removing it: nothing runs on it that needs the lease.
    case "suspended":
    case "removing":
    case "destroyed":
      return [];
    default:
      return neutral(host.phase);
  }
}

/**
 * The lease is renewed when due, and before any suspend: core can refuse the suspend (machine_busy) or
 * fail to stop the sandbox, which then keeps running on the lease it has.
 */
function planActive(host: HostView, sandbox: Sandbox, policy: SweepPolicy): SweepAction[] {
  if (isIdle(host, policy)) return [...leaseIfDue(sandbox, policy), { kind: "suspend-idle", hostId: host.hostId }];
  // A machine never seen before starts its idle clock now rather than counting as idle forever.
  const markActive: SweepAction[] = host.busy || host.lastActiveAt === null ? [{ kind: "mark-active", hostId: host.hostId }] : [];
  return [...markActive, ...leaseIfDue(sandbox, policy)];
}

const isIdle = ({ busy, lastActiveAt }: HostView, { now, idleMs }: SweepPolicy): boolean =>
  !busy && lastActiveAt !== null && idleMs !== null && now - lastActiveAt >= idleMs;

function leaseIfDue(sandbox: Sandbox, { now }: SweepPolicy): SweepAction[] {
  return sandbox.archiveAfter !== null && sandbox.archiveAfter - now < RENEW_BELOW_MS
    ? [{ kind: "renew-lease", sandboxId: sandbox.id }]
    : [];
}

/** A phase a newer bb adds is a compile error here, and nothing at run time. */
function neutral(phase: never): SweepAction[] {
  void phase;
  return [];
}
