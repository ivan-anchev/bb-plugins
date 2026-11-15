// A started crew on the board: its id, title, headline and branch, opening its thread. A row placed
// by a verdict has a Verdict button that shows the verdict under it; a row under Verifying links its
// verifier, which is hidden from the sidebar.
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useId, useState, type Ref } from "react";
import type { BoardRow } from "../../contract.ts";
import { Button } from "../ui/button.tsx";
import { VerdictDetail } from "./verdict-detail.tsx";

// why a grid: the headline lines up under the title, whatever the id's width.
const ROW = "grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-left";

export function CrewRow({ ref, row }: { ref: Ref<HTMLButtonElement>; row: BoardRow }) {
  const navigate = useBbNavigate();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const verdict = row.verdict;
  const judged = verdict?.state === "returned" || verdict?.state === "could-not-run";
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-1">
        <Summary ref={ref} row={row} />
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
      {judged && open && <VerdictDetail id={`${ids}-verdict`} verdict={verdict} />}
    </div>
  );
}

function Summary({ ref, row }: { ref: Ref<HTMLButtonElement>; row: BoardRow }) {
  const navigate = useBbNavigate();
  const body = (
    <>
      <span className="font-mono text-xs text-muted-foreground">{row.crewId}</span>
      <span className="truncate text-sm">{row.title}</span>
      <span className="col-start-2 text-xs text-muted-foreground">{row.headline}</span>
      {row.branch !== null && (
        <span className="col-start-2 flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
          <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{row.branch}</span>
        </span>
      )}
    </>
  );
  const threadId = row.threadId;
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
