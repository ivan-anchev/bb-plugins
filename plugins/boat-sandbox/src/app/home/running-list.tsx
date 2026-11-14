// The boats running now, as Activity sidebar's compact rows: the agent's mark in a 30 slot, the project
// tile, the title fading out, then the boat's size and its cost this month, ticking every second. Three
// show, most expensive first; "N more running" opens the rest. A row opens its thread.
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { RunningBoat } from "../../contract.ts";
import { costAt } from "../../spend/money.ts";
import { BoatMark } from "../boat-mark.tsx";
import { useNow } from "./clock.ts";
import { FadingTitle } from "./fading-title.tsx";
import { usd } from "./format.ts";
import { hueOf } from "./project-hue.ts";

const SHOWN = 3;
const TICK_MS = 1_000;
const EMPTY = "None right now. Choose boat Sandbox as a new thread’s environment to start one.";

type SidebarState = ReturnType<typeof useSidebarThreads>;
type Thread = SidebarState["threads"][number];
type Project = SidebarState["projects"][number];

/** `live`: costs grow from `readAt` as time passes; otherwise they hold at what boat last read. */
export function RunningList({ boats, readAt, live }: { boats: readonly RunningBoat[]; readAt: number; live: boolean }) {
  const [open, setOpen] = useState(false);
  const now = useNow(TICK_MS);
  const { threads, projects } = useSidebarThreads();
  const shown = open ? boats : boats.slice(0, SHOWN);
  const perHour = boats.reduce((sum, boat) => sum + boat.dollarsPerHour, 0);

  return (
    <div className="bs-run">
      <div className="bs-section-title">
        <span>Running</span>
        {boats.length > 0 && (
          <>
            <span className="bs-count">{boats.length}</span>
            <span className="bs-count bs-end">{usd(perHour)}/h</span>
          </>
        )}
      </div>
      {boats.length === 0 ? (
        <p className="bs-empty">{EMPTY}</p>
      ) : (
        <>
          <ul className="bs-list">
            {shown.map((boat) => {
              const thread = threads.find((t) => t.id === boat.threadId) ?? null;
              return (
                <li key={boat.threadId} className="bs-rowbox">
                  <BoatRow boat={boat} thread={thread} project={projects.find((p) => p.id === thread?.projectId) ?? null} cost={costAt(boat, readAt, live ? now : readAt)} />
                </li>
              );
            })}
          </ul>
          {boats.length > SHOWN && (
            <button type="button" className="bs-more" aria-expanded={open} onClick={() => setOpen(!open)}>
              <span className="bs-slot">
                <Icon name={open ? "ChevronUp" : "ChevronDown"} className="bs-more-icon" aria-hidden />
              </span>
              <span className="bs-title">{open ? "Show fewer" : `${boats.length - SHOWN} more running`}</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** A boat whose thread bb no longer lists (archived, say) keeps its row, named as `boat list` names it, but opens nothing. */
function BoatRow({ boat, thread, project, cost }: { boat: RunningBoat; thread: Thread | null; project: Project | null; cost: number }) {
  const body = (
    <>
      <span className="bs-slot">
        <span className="bs-mark">{thread === null ? <BoatMark className="bs-mark-icon" /> : <AgentMark providerId={thread.providerId} />}</span>
      </span>
      <span className="bs-line">
        <span className="bs-lead">
          {project !== null && (
            <span className="bs-tile" data-hue={hueOf(project.id)} aria-hidden>
              {(project.name.at(0) ?? "?").toUpperCase()}
            </span>
          )}
          <FadingTitle text={thread?.displayTitle ?? `bb ${boat.threadId}`} />
        </span>
        <span className="bs-size">
          <span>{boat.size}</span>
        </span>
        <span className="bs-hint">{usd(cost, 3)}</span>
      </span>
    </>
  );
  // The host routes a plain click on a thread's href in place.
  return thread === null ? <div className="bs-row">{body}</div> : <a href={thread.href} className="bs-row">{body}</a>;
}

/** The agent's artwork from bb's provider directory; bb's fallback glyph while it loads. */
function AgentMark({ providerId }: { providerId: string }) {
  const { providers } = useProviders();
  return <ProviderIcon providerKind="agent" provider={providers.find((p) => p.id === providerId) ?? { id: providerId }} aria-hidden />;
}
