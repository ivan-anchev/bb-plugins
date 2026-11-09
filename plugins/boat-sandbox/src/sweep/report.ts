// `bb boat sandboxes`: the sweep's look at bb and boat, one row per sandbox, with what the next sweep would do.
import type { Sandbox, SandboxId, SandboxPhase } from "../boat/sandbox.ts";
import { formatTable } from "../table.ts";
import type { HostPhase, HostView, SweepAction, SweepInput } from "./plan.ts";

export interface SandboxRow {
  sandboxId: SandboxId;
  /** boat's machine size; null once boat no longer has the sandbox. */
  type: string | null;
  /** `gone`: boat no longer has it. */
  boatPhase: SandboxPhase | "gone";
  /** The bb machine using it; null for an orphan. */
  machine: { hostId: string; phase: HostPhase } | null;
  /** boat's auto-stop deadline, ISO 8601; null when none is set. */
  archiveAfter: string | null;
  /** What is off about the sandbox, then one note per action the next sweep would take. */
  notes: string[];
}

/** Every machine's sandbox, in bb's order, then every owned sandbox no machine uses. */
export function sandboxRows({ hosts, sandboxes }: SweepInput, actions: readonly SweepAction[]): SandboxRow[] {
  const referenced = new Set(hosts.map((host) => host.sandboxId));
  const orphans = [...sandboxes.values()].filter((sandbox) => !referenced.has(sandbox.id));
  const rows = [
    ...hosts.map((host) => machineRow(host, sandboxes.get(host.sandboxId) ?? null)),
    ...orphans.map((sandbox) => ({ ...sandboxColumns(sandbox), machine: null, notes: [...stopNotes(sandbox), "orphan: no bb machine uses it"] })),
  ];
  return rows.map((row) => ({ ...row, notes: [...row.notes, ...actions.filter((action) => concerns(row, action)).map(describeAction)] }));
}

function machineRow(host: HostView, sandbox: Sandbox | null): SandboxRow {
  const machine = { hostId: host.hostId, phase: host.phase };
  if (sandbox !== null) return { ...sandboxColumns(sandbox), machine, notes: stopNotes(sandbox) };
  return {
    sandboxId: host.sandboxId,
    type: null,
    boatPhase: "gone",
    machine,
    archiveAfter: null,
    notes: [`no longer exists on boat, so a follow-up cannot resume it; remove the machine with \`bb machine remove ${host.hostId} --yes\``],
  };
}

const sandboxColumns = (sandbox: Sandbox) => ({
  sandboxId: sandbox.id,
  type: sandbox.type,
  boatPhase: sandbox.phase,
  archiveAfter: sandbox.archiveAfter === null ? null : new Date(sandbox.archiveAfter).toISOString(),
});

const stopNotes = ({ stopNote }: Sandbox): string[] => (stopNote === null ? [] : [stopNote]);

const concerns = (row: SandboxRow, action: SweepAction): boolean =>
  "hostId" in action ? action.hostId === row.machine?.hostId : action.sandboxId === row.sandboxId;

function describeAction(action: SweepAction): string {
  switch (action.kind) {
    case "mark-active":
      return "sweep will reset the idle clock";
    case "suspend-idle":
      return "idle past the limit: sweep will suspend the machine";
    case "renew-lease":
      return "auto-stop under an hour away: sweep will renew it to 2 hours";
    case "record-stopped":
      return "sweep will record the machine as suspended";
    case "stop-again":
      return "running while bb has the machine suspended: sweep will stop it again";
    case "stop-orphan":
      return "sweep will stop it, keeping its disk";
    default:
      return action satisfies never;
  }
}

const HEADER = ["SANDBOX", "TYPE", "BOAT", "MACHINE", "AUTO-STOP", "NOTES"] as const;

/** One line per sandbox; notes are joined into the last column. */
export function formatRows(rows: readonly SandboxRow[]): string {
  if (rows.length === 0) return "This bb server has no boat sandboxes.\n";
  return formatTable(HEADER, rows.map(rowCells));
}

function rowCells(row: SandboxRow): readonly string[] {
  return [
    row.sandboxId,
    row.type ?? "-",
    row.boatPhase,
    row.machine === null ? "-" : `${row.machine.hostId} (${row.machine.phase})`,
    // To the minute, in UTC: 2026-11-08T21:30Z.
    row.archiveAfter === null ? "-" : `${row.archiveAfter.slice(0, 16)}Z`,
    row.notes.join("; "),
  ];
}
