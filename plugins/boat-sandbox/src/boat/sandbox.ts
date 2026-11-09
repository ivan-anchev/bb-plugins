// The one boat-side concept: a sandbox, with boat's wire states collapsed to five phases.
import type { z } from "zod";
import { wireSandbox, type PresentSandbox, type sandboxId } from "./wire.ts";

export type SandboxId = z.output<typeof sandboxId>;
export type SandboxPhase = "starting" | "running" | "stopping" | "stopped" | "failed";

export interface Sandbox {
  id: SandboxId;
  phase: SandboxPhase;
  /** boat's machine size, for example `small`. */
  type: string;
  labels: Readonly<Record<string, string>>;
  createdAt: number;
  /** The auto-stop deadline; null when auto-stop is off. */
  archiveAfter: number | null;
  stoppedAt: number | null;
  dataExpired: boolean;
  /** Human text only (logs, CLI). Never branch on it. */
  stopNote: string | null;
  /** boat put the account's sign-ins on it; false for a no-env sandbox. */
  holdsLogins: boolean;
  /** The environment boat attached; null for none. */
  environment: string | null;
}

// `idle` and `running` only describe work queued through boat's own prompt API, and a fresh
// create settles in `idle`, never `ready` (spike Q1), so all three mean the machine is up.
const PHASES: Record<PresentSandbox["state"], SandboxPhase> = {
  init: "starting",
  provisioning: "starting",
  provisioned: "starting",
  cloning: "starting",
  ready: "running",
  idle: "running",
  running: "running",
  archiving: "stopping",
  archived: "stopped",
  error: "failed",
};

/** boat bills it and runs commands on it, or soon will. */
export const isAwake = (sandbox: Sandbox): boolean => sandbox.phase === "starting" || sandbox.phase === "running";

/** Parses one sandbox object from boat. `cancelled` is boat's "gone", so it is null, like a 404. */
export function toSandbox(json: unknown): Sandbox | null {
  const wire = wireSandbox.parse(json);
  if (wire.state === "cancelled") return null;
  return {
    id: wire.id,
    phase: PHASES[wire.state],
    type: wire.type,
    labels: wire.labels,
    createdAt: wire.createdAt,
    archiveAfter: wire.archiveAfter,
    stoppedAt: wire.stoppedAt,
    dataExpired: wire.dataExpiredAt !== null,
    stopNote: describeStop(wire),
    holdsLogins: wire.holdsCreatorLogins,
    environment: wire.environment,
  };
}

/**
 * An API stop ends the moment the sandbox stops (18 ms apart, live 2026-11-08), and an older one at
 * least a resume and a ~14 s stop earlier, so this tells the current stop's record from an old one.
 */
const SAME_STOP_MS = 5_000;

function describeStop(wire: PresentSandbox): string | null {
  if (wire.state !== "archived" && wire.state !== "error") return null;
  if (wire.error !== null) return `boat: ${wire.error}`;
  // A boat-initiated stop (auto-stop, wallet, maintenance) adds no stop record (spike Q7), but the
  // sandbox keeps the record of the last API stop, which may be an earlier one.
  return stoppedThroughApi(wire) ? "stopped through the API" : "stopped by boat";
}

const stoppedThroughApi = ({ stop, stoppedAt }: PresentSandbox): boolean =>
  stop?.endedAt != null && stoppedAt !== null && stop.endedAt >= stoppedAt - SAME_STOP_MS;
