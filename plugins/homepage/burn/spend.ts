import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { burnTotalsSchema, type BurnRange, type BurnSpend } from "../contract.ts";

/** Burn's plugin id (github.com/kalindudc/burn). */
export const BURN_PLUGIN_ID = "burn";

type CallRpc = BbPluginApi["sdk"]["plugins"]["callRpc"];

/**
 * Burn's spend and tokens over `range`, every project. why parse only four fields: Burn is 0.x, and the
 * rest of its reply (days, threads, models…) can change shape without this card noticing.
 */
export async function readBurnSpend(callRpc: CallRpc, range: BurnRange, signal?: AbortSignal): Promise<BurnSpend> {
  try {
    const totals = await callRpc({
      pluginId: BURN_PLUGIN_ID,
      method: "spend",
      input: { range, projectId: null },
      outputSchema: burnTotalsSchema,
      signal,
    });
    return { status: "ready", ...totals };
  } catch (error) {
    return { status: "unavailable", message: describeBurnFailure(error) };
  }
}

/**
 * One short line for why Burn couldn't be read. bb answers a call to another plugin with an HTTP error
 * (`status`, `code`, and a message like `HTTP 503: plugin "burn" is not running (status: disabled)`);
 * a reply that doesn't match the schema throws Zod's error.
 */
export function describeBurnFailure(error: unknown): string {
  const { status, code, message, name } = errorParts(error);
  if (name === "ZodError") return "Burn’s reply changed shape. Update Homepage to read it.";
  if (status === 404 && /unknown plugin/i.test(message)) return "Install the Burn plugin to see spend here.";
  if (status === 503 && /status: disabled/.test(message)) return "Burn is turned off. Turn it on in Extensions to see spend here.";
  if (status === 503 && /status: starting/.test(message)) return "Burn is starting…";
  if (status === 503) return "Burn isn’t running. Check it in Extensions.";
  if (code === "unknown_method" || code === "invalid_input") return "This version of Burn can’t report spend here. Update Burn.";
  return `Couldn’t read Burn: ${clip(message.replace(/^HTTP \d+: /, ""))}`;
}

function errorParts(error: unknown): { status: number | null; code: string | null; message: string; name: string } {
  if (typeof error !== "object" || error === null) return { status: null, code: null, message: String(error), name: "" };
  const { status, code, message, name } = error as Record<string, unknown>;
  return {
    status: typeof status === "number" ? status : null,
    code: typeof code === "string" ? code : null,
    message: typeof message === "string" ? message : String(error),
    name: typeof name === "string" ? name : "",
  };
}

const clip = (text: string): string => (text.length > 120 ? `${text.slice(0, 119)}…` : text);
