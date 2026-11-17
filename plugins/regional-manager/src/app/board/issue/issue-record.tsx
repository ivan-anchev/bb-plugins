// An issue's record: each agent that held it, oldest first, how it ended, and its handoffs. A
// handoff opens to the verdict on it, then what the agent reported; the latest is open.
import type { EndedHow } from "../../../model/agent.ts";
import type { NextHandoff } from "../../../model/handoff.ts";
import { shortTime } from "../../ui/time.ts";
import type { AgentRecord, HandedOff } from "./board-issue.ts";
import { CheckVerdict } from "./check-verdict.tsx";
import { DiscloseGlyph } from "./disclose-glyph.tsx";
import { ThreadLink } from "./thread-link.tsx";

export function IssueRecord({ record }: { record: readonly AgentRecord[] }) {
  const latest = record.flatMap(({ handoffs }) => handoffs).at(-1)?.id ?? null;
  return (
    <ol className="rmi-record">
      {record.map(({ agent, handoffs }) => (
        <li key={agent.id} className="rmi-held">
          <p className="rmi-held-by">
            <ThreadLink name={agent.id} threadId={agent.threadId} />
            {agent.ended !== null && <span>{ENDED[agent.ended]}</span>}
          </p>
          {handoffs.length > 0 && (
            <ol className="rmi-handoffs">
              {handoffs.map((handoff) => (
                <li key={handoff.id}>
                  <Handoff handoff={handoff} open={handoff.id === latest} />
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
  );
}

function Handoff({ handoff, open }: { handoff: HandedOff; open: boolean }) {
  const reported = [
    { title: "Did", items: handoff.did },
    { title: "Evidence", items: handoff.evidence, code: true },
    { title: "Concerns", items: handoff.concerns },
    { title: "Deviations", items: handoff.deviations },
    { title: "Findings", items: handoff.findings },
  ].filter((part) => part.items.length > 0);
  return (
    <details open={open} className="rmi-handoff">
      <summary>
        <DiscloseGlyph />
        <span className="rmi-handoff-status" data-status={handoff.status}>
          {STATUS[handoff.status]}
        </span>
        <span className="rmi-handoff-summary">{handoff.summary}</span>
        <time dateTime={new Date(handoff.at).toISOString()}>{shortTime(handoff.at)}</time>
      </summary>
      <div className="rmi-handoff-body">
        {handoff.verdict !== null && <CheckVerdict verdict={handoff.verdict} />}
        {reported.map(({ title, items, code }) => (
          <section key={title} className="rmi-reported">
            <h4>{title}</h4>
            <ul data-code={code || undefined}>
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

const STATUS: Record<NextHandoff["status"], string> = { done: "Done", blocked: "Blocked", "gave-up": "Gave up" };

const ENDED: Record<EndedHow, string> = { stopped: "Stopped", archived: "Archived", deleted: "Deleted", "spawn-failed": "Never started" };
