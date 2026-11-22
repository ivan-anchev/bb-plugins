import { useEffect, useState, type ReactNode } from "react";
import { useRpc, type ExperimentalThreadActionTabProps, type ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { boatSandboxContract as contract, type ComputerView } from "../../contract.ts";
import { NOT_READ, readComputerEvery, type ComputerReading } from "./computer-reader.ts";
import { MONITOR_ICON } from "./monitor-icon.tsx";
import { useRunsOnBoat } from "./runs-on-boat.ts";

/** The tab's address, for `openTab`: one instance per thread, since it takes no params. */
export const COMPUTER_TAB = { id: "computer", context: { kind: "thread" }, availability: "action" } as const;

export const computerTab = {
  ...COMPUTER_TAB,
  title: "Computer",
  icon: MONITOR_ICON,
  tooltip: "The boat sandbox's desktop, live and view only",
  layout: "flush",
  component: ComputerPage,
  useVisible: ({ environment }: ExperimentalThreadTabProps) => useRunsOnBoat(environment),
} as const;

function ComputerPage({ environment }: ExperimentalThreadActionTabProps) {
  return (
    <div tabIndex={0} className="flex h-full min-h-0 flex-col text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      {environment === null ? <Notice>This thread has no environment, so it has no computer.</Notice> : <Computer key={environment.id} environmentId={environment.id} />}
    </div>
  );
}

function Computer({ environmentId }: { environmentId: string }) {
  const { view, failure } = useComputer(environmentId);
  if (view === undefined) return <Notice>{failure === null ? "Connecting to the sandbox…" : `Could not read the sandbox: ${failure}`}</Notice>;
  return (
    <>
      {failure !== null && <p className="px-4 pt-2 text-xs text-muted-foreground">Could not read the sandbox again: {failure}</p>}
      <ComputerState view={view} />
    </>
  );
}

function ComputerState({ view }: { view: ComputerView }) {
  switch (view.status) {
    case "ready":
      return <Desktop url={view.url} />;
    case "provisioning":
      return <Notice>Starting the desktop view. This takes about half a minute the first time.</Notice>;
    case "starting":
      return <Notice>The sandbox is starting.</Notice>;
    case "stopped":
      return <Notice>The sandbox is stopped. It resumes when the thread works again.</Notice>;
    case "unavailable":
      return <Notice>{view.message}</Notice>;
    case "not-boat":
      return <Notice>This thread does not run on a boat sandbox.</Notice>;
    default:
      view satisfies never;
      return null;
  }
}

function Desktop({ url }: { url: string }) {
  return (
    <div className="flex flex-col gap-2">
      <iframe src={url} title="Sandbox desktop, view only" inert className="block aspect-video w-full border-0" />
      <p className="px-4 text-xs text-muted-foreground">View only</p>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="m-auto max-w-80 px-6 text-center text-sm text-muted-foreground text-pretty">{children}</p>;
}

function useComputer(environmentId: string): ComputerReading {
  const rpc = useRpc<typeof contract>();
  const [reading, setReading] = useState(NOT_READ);
  useEffect(() => readComputerEvery(() => rpc.call("computer", { environmentId }), setReading, () => !document.hidden), [rpc, environmentId]);
  return reading;
}
