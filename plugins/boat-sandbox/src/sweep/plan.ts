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
  | { kind: "record-stopped"; hostId: string; why: string }
  | { kind: "stop-again"; hostId: string }
  | { kind: "stop-orphan"; sandboxId: SandboxId };

const RENEW_BELOW_MS = 60 * 60_000;
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
    case "creating":
    case "resuming":
    case "suspending":
      return sandbox !== null && isAwake(sandbox) ? leaseIfDue(sandbox, policy) : [];
    case "removing":
    case "destroyed":
      return [];
    default:
      return neutral(host.phase);
  }
}

function planActive(host: HostView, sandbox: Sandbox | null, policy: SweepPolicy): SweepAction[] {
  if (sandbox === null) return [recordStopped(host, `boat sandbox ${host.sandboxId} no longer exists`)];
  if (!isAwake(sandbox)) return [recordStopped(host, `boat sandbox ${sandbox.id} is ${describePhase(sandbox)}`)];
  if (isIdle(host, policy)) return [...leaseIfDue(sandbox, policy), { kind: "suspend-idle", hostId: host.hostId }];
  const markActive: SweepAction[] = host.busy || host.lastActiveAt === null ? [{ kind: "mark-active", hostId: host.hostId }] : [];
  return [...markActive, ...leaseIfDue(sandbox, policy)];
}

function planSuspended(host: HostView, sandbox: Sandbox | null): SweepAction[] {
  return sandbox !== null && isAwake(sandbox) ? [{ kind: "stop-again", hostId: host.hostId }] : [];
}

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

function neutral(phase: never): SweepAction[] {
  void phase;
  return [];
}
