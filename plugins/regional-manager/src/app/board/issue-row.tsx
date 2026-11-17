// An issue on the board: its id, title, kind, its status when it sits under Needs you, its latest
// agent and headline, and its branch, opening that agent's thread, then its pull request and CI as
// last read, linking to GitHub. A row placed by a verdict has a Verdict button that shows the verdict
// under it; a row under Verifying links its verifier, which is hidden from the sidebar.
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useId, useState, type Ref } from "react";
import type { IssueRow as Row } from "../../contract.ts";
import { laneOf } from "../../model/board/board-groups.ts";
import { PIPELINES } from "../../model/issue/kind.ts";
import { STATUS_LABELS } from "../../model/issue/status.ts";
import type { PrSnapshot } from "../../model/verdict/pr.ts";
import { Button } from "../ui/button.tsx";
import { VerdictDetail } from "./verdict-detail.tsx";

// why a grid: the headline lines up under the title, whatever the id's width.
const ROW = "grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-left";

export function IssueRow({ ref, issue }: { ref: Ref<HTMLButtonElement>; issue: Row }) {
  const navigate = useBbNavigate();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const verdict = issue.placing?.verdict ?? null;
  const judged = verdict?.state === "returned" || verdict?.state === "could-not-run";
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-1">
        <Summary ref={ref} issue={issue} />
        {judged && (
          <div className="shrink-0 pt-1">
            <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`${ids}-verdict`} onClick={() => setOpen(!open)}>
              Verdict
              <Icon name="ChevronDown" aria-hidden className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
            </Button>
          </div>
        )}
        {verdict?.state === "running" && (
          <div className="shrink-0 pt-1">
            <Button variant="ghost" size="sm" onClick={() => navigate.toThread(verdict.verifierThreadId)}>
              Verifier
              <Icon name="ArrowUpRight" aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {issue.pr !== null && <PrLine pr={issue.pr} />}
      {judged && open && <VerdictDetail id={`${ids}-verdict`} verdict={verdict} />}
    </div>
  );
}

function Summary({ ref, issue }: { ref: Ref<HTMLButtonElement>; issue: Row }) {
  const navigate = useBbNavigate();
  const body = (
    <>
      <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
      <span className="truncate text-sm">{issue.title}</span>
      <span className="col-start-2 text-xs text-muted-foreground">{factsOf(issue).join(" · ")}</span>
      {issue.branch !== null && (
        <span className="col-start-2 flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
          <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{issue.branch}</span>
        </span>
      )}
    </>
  );
  const threadId = issue.agent?.threadId ?? null;
  if (threadId === null) return <div className={ROW}>{body}</div>;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => navigate.toThread(threadId)}
      className={`${ROW} cursor-pointer hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
    >
      {body}
    </button>
  );
}

/**
 * The line under the title: the issue's kind, its status when its lane doesn't say it (under Needs
 * you), its latest agent, and its headline.
 */
function factsOf(issue: Row): string[] {
  const status = laneOf(issue) === issue.status ? [] : [STATUS_LABELS[issue.status]];
  return [PIPELINES[issue.kind].label, ...status, ...(issue.agent === null ? [] : [issue.agent.id]), issue.headline];
}

/** The issue's pull request as last read: a link to it, its state, its CI on its head commit, and its review. */
function PrLine({ pr }: { pr: PrSnapshot }) {
  const state = pr.state === "open" && pr.draft ? DRAFT : PR_STATE[pr.state];
  const ci = CI[pr.ci];
  const review = REVIEW[pr.review];
  return (
    // why the inset: it lines up under the title, past the row's id column (px-2, the 2.25rem column, gap-x-2).
    <p className="-mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pr-2 pb-1.5 pl-[3.25rem] text-xs text-muted-foreground">
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-sm font-mono text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon name={state.icon} aria-hidden className={`size-3 ${state.tone}`} />#{pr.number}
        <span className="sr-only"> on GitHub</span>
      </a>
      <span>{state.label}</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        <Icon name={ci.icon} aria-hidden className={`size-3 ${ci.tone}`} />
        {ci.label}
      </span>
      {review !== null && (
        <>
          <span aria-hidden>·</span>
          <span>{review}</span>
        </>
      )}
    </p>
  );
}

type Look = { label: string; icon: string; tone: string };

// why the words stay muted: a coloured label fails contrast on the page; the icon carries the colour.
const PR_STATE: Record<PrSnapshot["state"], Look> = {
  open: { label: "Open", icon: "GitPullRequest", tone: "text-success" },
  merged: { label: "Merged", icon: "GitMerge", tone: "text-pr-merged" },
  closed: { label: "Closed", icon: "GitPullRequestClosed", tone: "text-destructive-text" },
};
const DRAFT: Look = { label: "Draft", icon: "GitPullRequestDraft", tone: "text-muted-foreground" };

const CI: Record<PrSnapshot["ci"], Look> = {
  none: { label: "No checks", icon: "Minus", tone: "text-muted-foreground" },
  pending: { label: "CI running", icon: "Clock", tone: "text-attention" },
  pass: { label: "CI passing", icon: "Check", tone: "text-success" },
  fail: { label: "CI failing", icon: "X", tone: "text-destructive-text" },
};

const REVIEW: Record<PrSnapshot["review"], string | null> = { approved: "Approved", "changes-requested": "Changes requested", none: null };
