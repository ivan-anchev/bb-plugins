import type { JsonValue, PluginMachineProviderInputsChange } from "@get-bb/plugin-sdk";
import type { LaunchChoicesReply } from "../contract.ts";
import { machineInputs, resolveLaunch, type Launch, type LaunchChoices, type MachineInputs } from "../launch.ts";

/** The `launchChoices` query as it stands. A read that fails keeps the data an earlier read loaded. */
export interface ChoicesQuery {
  data: LaunchChoicesReply | undefined;
  error: Error | null;
}

export interface ChipView {
  report: PluginMachineProviderInputsChange;
  label: string;
  /** Shown with a warning icon on the chip and at the top of its menu. */
  problem: string | null;
  /** The launch the menu marks as chosen; null until the choices load and the value resolves. */
  launch: Launch | null;
}

/** The last read decides: earlier data a failed read keeps is offered, never trusted to block. */
export function chipView(value: JsonValue | null, { data, error }: ChoicesQuery): ChipView {
  const parsed = parseValue(value);
  if (error !== null) return failedView(parsed, error.message, data ?? null);
  if (data === undefined) return { report: ready(parsed.json), label: "boat sandbox", problem: null, launch: null };
  return data.status === "ready" ? resolvedView(parsed.inputs, data) : blocked("boat: set up", data.message);
}

/**
 * What choosing a menu item reports: the current launch with `change` applied. From a refused value
 * every item is a way out, so the rest starts at boat's stock image in boat's default environment.
 */
export function pick(current: Launch | null, choices: LaunchChoices, change: Partial<Launch>): PluginMachineProviderInputsChange {
  return resolvedView({ ...(current ?? escapeHatch(choices)), ...change }, choices).report;
}

const labelOf = ({ template, environment, preset }: Launch): string => `${template ?? "stock image"} · ${environment} · ${preset}`;

function resolvedView(inputs: MachineInputs, choices: LaunchChoices): ChipView {
  const resolution = resolveLaunch(inputs, choices);
  if (!resolution.ok) return blocked(resolution.name, resolution.message);
  const { launch } = resolution;
  return { report: ready({ ...launch }), label: labelOf(launch), problem: null, launch };
}

function failedView({ inputs, json }: ParsedValue, message: string, retained: LaunchChoicesReply | null): ChipView {
  const resolution = retained?.status === "ready" ? resolveLaunch(inputs, retained) : null;
  const launch = resolution?.ok === true ? resolution.launch : null;
  return {
    report: ready(json),
    label: launch === null ? "boat: list failed" : labelOf(launch),
    problem: `Could not list boat templates: ${message}`,
    launch,
  };
}

function escapeHatch({ environments, defaults }: LaunchChoices): MachineInputs {
  const boatDefault = environments.find((environment) => environment.isBoatDefault);
  return { template: null, environment: boatDefault?.name, preset: defaults.preset };
}

interface ParsedValue {
  inputs: MachineInputs;
  json: JsonValue;
}

function parseValue(value: JsonValue | null): ParsedValue {
  const parsed = machineInputs.safeParse(value ?? {});
  return parsed.success ? { inputs: parsed.data, json: value ?? {} } : { inputs: {}, json: {} };
}

const ready = (value: JsonValue): PluginMachineProviderInputsChange => ({ status: "ready", value });

const blocked = (label: string, reason: string): ChipView => ({ report: { status: "blocked", reason }, label, problem: reason, launch: null });
