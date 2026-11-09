// The one boat-side concept: a sandbox, with boat's wire states collapsed to five phases.
import type { z } from "zod";
import { wireSandbox, type PresentSandbox, type sandboxId } from "./wire.ts";

export type SandboxId = z.output<typeof sandboxId>;
export type SandboxPhase = "starting" | "running" | "stopping" | "stopped" | "failed";

export interface Sandbox {
  id: SandboxId;
  phase: SandboxPhase;
  labels: Readonly<Record<string, string>>;
  createdAt: number;
  /** The auto-stop deadline; null when auto-stop is off. */
  archiveAfter: number | null;
  stoppedAt: number | null;
  dataExpired: boolean;
  /** Human text only (logs, CLI). Never branch on it. */
  stopNote: string | null;
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
    labels: wire.labels,
    createdAt: wire.createdAt,
    archiveAfter: wire.archiveAfter,
    stoppedAt: wire.stoppedAt,
    dataExpired: wire.dataExpiredAt !== null,
    stopNote: describeStop(wire),
  };
}

function describeStop(wire: PresentSandbox): string | null {
  if (wire.state !== "archived" && wire.state !== "error") return null;
  if (wire.error !== null) return `boat: ${wire.error}`;
  // A boat-initiated stop (auto-stop, wallet, maintenance) leaves no stop record (spike Q7).
  return wire.stop === null ? "stopped by boat" : "stopped through the API";
}
