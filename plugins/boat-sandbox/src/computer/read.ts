import type { ExperimentalPluginRpcHandlersWithContext, JsonValue } from "@get-bb/plugin-sdk";
import { BoatApiError, type BoatClient } from "../boat/client.ts";
import type { SandboxId } from "../boat/sandbox.ts";
import { boatHostOf, type EnvironmentHostReader } from "../boat-hosts.ts";
import type { boatSandboxContract, ComputerView } from "../contract.ts";
import { parseResource } from "../ownership.ts";
import { describeProblems, type Problem } from "../problem.ts";

type ComputerClient = Pick<BoatClient, "get" | "vncDesktop">;

/** The part of `BoatAccess` the read needs: a client, or why there is none. */
interface ComputerAccess {
  configuration(signal: AbortSignal): Promise<{ status: "available"; client: ComputerClient } | { status: "setup-required" | "refused" | "read-failed"; problems: readonly Problem[] }>;
}

interface ComputerDeps {
  sdk: EnvironmentHostReader;
  machines: { getResource(hostId: string): Promise<JsonValue | null> };
  access: ComputerAccess;
}

const STARTING: ComputerView = { status: "starting" };
const STOPPED: ComputerView = { status: "stopped" };

export const computerRpcHandlers = (deps: ComputerDeps): Pick<ExperimentalPluginRpcHandlersWithContext<typeof boatSandboxContract>, "computer"> => ({
  computer: ({ environmentId }, { experimental_signal: signal }) => readComputer(deps, environmentId, signal),
});

async function readComputer(deps: ComputerDeps, environmentId: string, signal: AbortSignal): Promise<ComputerView> {
  const hostId = await boatHostOf(deps.sdk, environmentId, signal);
  if (hostId === null) return { status: "not-boat" };
  const resource = await deps.machines.getResource(hostId);
  if (resource === null) return STARTING;
  const configuration = await deps.access.configuration(signal);
  if (configuration.status !== "available") return { status: "unavailable", message: describeProblems(configuration.problems) };
  return viewSandbox(configuration.client, parseResource(resource).sandboxId, signal);
}

async function viewSandbox(client: ComputerClient, id: SandboxId, signal: AbortSignal): Promise<ComputerView> {
  const sandbox = await client.get(id, signal);
  if (sandbox === null) return { status: "unavailable", message: `boat no longer has the sandbox ${id}.` };
  switch (sandbox.phase) {
    case "starting":
      return STARTING;
    case "stopping":
    case "stopped":
      return STOPPED;
    case "failed":
      return { status: "unavailable", message: `The sandbox ${id} failed${sandbox.stopNote === null ? "." : ` (${sandbox.stopNote}).`}` };
    case "running":
      return viewDesktop(client, id, signal);
    default:
      return sandbox.phase satisfies never;
  }
}

async function viewDesktop(client: ComputerClient, id: SandboxId, signal: AbortSignal): Promise<ComputerView> {
  try {
    const desktop = await client.vncDesktop(id, signal);
    return desktop.status === "ready" ? { status: "ready", url: viewOnly(desktop.url) } : { status: "provisioning" };
  } catch (error) {
    if (!(error instanceof BoatApiError)) throw error;
    if (error.code === "machine_not_running") return STOPPED;
    if (error.code === "desktop_not_ready") return STARTING;
    return { status: "unavailable", message: `boat refused the desktop view: ${error.message}` };
  }
}

function viewOnly(desktopUrl: string): string {
  const url = new URL(desktopUrl);
  url.searchParams.set("view_only", "true");
  url.searchParams.set("resize", "scale");
  url.searchParams.set("autoconnect", "true");
  url.searchParams.set("reconnect", "true");
  return url.href;
}
