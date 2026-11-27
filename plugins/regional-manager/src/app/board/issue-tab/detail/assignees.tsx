// An issue's Assignee value: every agent that held it, the holder first and then the earlier ones,
// the latest to end first, in subtle ink. Each is its provider's mark and its id, as Activity Sidebar
// marks a thread, with Activity's working ring on one bb runs a turn of; pressing one opens its
// thread. why no card on hover: nothing is hidden.
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useRef } from "react";
import type { IssueFeed } from "../../../../contract.ts";
import { useRing } from "../../../ui/motion/ring.ts";

type Assignee = IssueFeed["agents"][number];
/** A provider as ProviderIcon reads it, and its name (null: bb's directory doesn't list it, or not yet). */
type Provider = { icon: { id: string }; name: string | null };

export function Assignees({ agents }: { agents: readonly Assignee[] }) {
  const underWay = useUnderWayThreads();
  const providerOf = useProviderOf();
  if (agents.length === 0) return <span className="rmi-assignee-none">None</span>;
  return holderFirst(agents).map((agent) => (
    <AssigneeChip key={agent.id} agent={agent} provider={providerOf(agent.providerId)} working={agent.threadId !== null && underWay.has(agent.threadId)} />
  ));
}

/** One agent, a tab stop that opens its thread; once bb no longer has the thread, a tab stop that only names it. */
function AssigneeChip({ agent, provider, working }: { agent: Assignee; provider: Provider; working: boolean }) {
  const navigate = useBbNavigate();
  const spoken = `${agent.id}, ${provider.name ?? provider.icon.id}, ${working ? "working" : "not working"}`;
  const look = { className: "rmi-assignee", "data-earlier": agent.ended !== null || undefined };
  const face = (
    <>
      {working && <WorkingRing />}
      <span className="rmi-assignee-mark">
        <ProviderIcon providerKind="agent" provider={provider.icon} aria-hidden />
      </span>
      <span className="rmi-assignee-id">{agent.id}</span>
    </>
  );
  const { threadId } = agent;
  if (threadId === null) {
    return (
      <span {...look} role="img" aria-label={spoken} tabIndex={0}>
        {face}
      </span>
    );
  }
  return (
    <button type="button" {...look} aria-label={`${spoken}. Open its thread`} onClick={() => navigate.toThread(threadId)}>
      {face}
    </button>
  );
}

/** Activity Sidebar's working ring, 12 px, turning on the shared clock in the chip's ink. */
function WorkingRing() {
  const ref = useRef<HTMLCanvasElement>(null);
  useRing(ref, RING_SIZE);
  return <canvas ref={ref} className="rmi-assignee-ring" style={{ width: RING_SIZE, height: RING_SIZE }} aria-hidden />;
}

const RING_SIZE = 12;

// ------------------------------------------------------------------ layer 2

/** The threads bb runs a turn of now, from bb's live sidebar list. */
function useUnderWayThreads(): ReadonlySet<string> {
  const { threads } = useSidebarThreads();
  return new Set(threads.filter(({ status }) => isUnderWay(status)).map(({ id }) => id));
}

/**
 * Whether bb runs a turn of a thread in `status`: starting, active or stopping, as bb sorts busy
 * threads. why an unknown one isn't: bb can send a status newer than this SDK, which reads as idle.
 */
function isUnderWay(status: PluginSidebarThread["status"]): boolean {
  switch (status) {
    case "starting":
    case "active":
    case "stopping":
      return true;
    case "idle":
    case "pending":
    case "error":
      return false;
    default:
      status satisfies never;
      return false;
  }
}

/** A provider by its id, from bb's provider directory; its id alone while the directory doesn't list it, as Activity Sidebar's AgentMark does. */
function useProviderOf(): (providerId: string) => Provider {
  const { providers } = useProviders();
  return (providerId) => {
    const listed = providers.find(({ id }) => id === providerId);
    return listed === undefined ? { icon: { id: providerId }, name: null } : { icon: listed, name: listed.displayName };
  };
}

/** The holder first, then the agents that ended, the latest to end first. */
function holderFirst(agents: readonly Assignee[]): Assignee[] {
  const endOf = ({ ended }: Assignee) => (ended === null ? Number.POSITIVE_INFINITY : ended.at);
  return [...agents].sort((a, b) => (endOf(a) === endOf(b) ? 0 : endOf(b) > endOf(a) ? 1 : -1));
}
