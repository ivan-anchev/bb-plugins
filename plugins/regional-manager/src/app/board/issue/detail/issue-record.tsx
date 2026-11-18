// An issue's record: each agent that held it, oldest first, how it ended, and its handoffs. A
// handoff opens to the report it delivered or the verdict on it, then what the agent reported; the
// latest is open.
import { Markdown } from "@get-bb/plugin-sdk/app";
import { useId } from "react";
import type { IssueDetail } from "../../../../contract.ts";
import type { EndedHow } from "../../../../model/agent.ts";
import type { HandoffReport } from "../../../../model/handoff.ts";
import { shortTime } from "../../../ui/time.ts";
import { ThreadLink } from "../thread-link.tsx";
import { CheckVerdict } from "./check-verdict.tsx";
import { DiscloseGlyph } from "./disclose-glyph.tsx";

type HandedOff = IssueDetail["record"][number]["handoffs"][number];

export function IssueRecord({ record }: { record: IssueDetail["record"] }) {
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
        {handoff.report !== null && <Report {...handoff.report} />}
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

/**
 * A research handoff's report, as the Markdown it is, and the memory file it was saved to, where the
 * user reads and edits it in the Memory editor. why a box that scrolls: a report runs to 20,000
 * characters, and the board stays the board; the tab stop lets the keyboard scroll it (REVIEW.md).
 */
function Report({ report, file }: NonNullable<HandedOff["report"]>) {
  const headId = useId();
  return (
    <section className="rmi-reported">
      <h4 id={headId} className="rmi-report-head">
        Report <span className="rmi-report-file">{file}</span>
      </h4>
      <div tabIndex={0} role="region" aria-labelledby={headId} className="rmi-report">
        <Markdown content={report} />
      </div>
    </section>
  );
}

const STATUS: Record<HandoffReport["status"], string> = { done: "Done", blocked: "Blocked", "gave-up": "Gave up" };

const ENDED: Record<EndedHow, string> = { stopped: "Stopped", archived: "Archived", deleted: "Deleted", "spawn-failed": "Never started" };
