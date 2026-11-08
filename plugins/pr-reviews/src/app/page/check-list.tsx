// The side panel's checks, most urgent first: the first three always shown, the rest behind a
// disclosure; and the one status the Checks heading shows. Each check with a details page links to
// it, opened outside the app the way the header's GitHub button is; one without is plain text.
import { useId, useState, type ReactNode, type RefObject } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { leadingOutcome, summarizeChecks, type Check, type CheckOutcome } from "../../contract.ts";
import { Button } from "../ui/button.tsx";
import { CheckOutcomeIcon } from "./check-outcome-icon.tsx";

const ALWAYS_SHOWN = 3;

// `toggle` takes the disclosure's button: the side panel moves focus there when a refresh moves the
// focused check past the first three.
export function CheckList({ checks, toggle }: { checks: Check[]; toggle: RefObject<HTMLButtonElement | null> }) {
  const ordered = byPriority(checks);
  const more = ordered.slice(ALWAYS_SHOWN);
  return (
    <>
      <CheckRows checks={ordered.slice(0, ALWAYS_SHOWN)} />
      {more.length > 0 && <MoreDisclosure more={more} toggle={toggle} />}
    </>
  );
}

// Failing, then pending, then passing; GitHub's order within each.
const PRIORITY = ["failing", "pending", "passing"] as const satisfies readonly CheckOutcome[];
const byPriority = (checks: Check[]): Check[] => PRIORITY.flatMap((outcome) => checks.filter((check) => check.outcome === outcome));

// A pending check is one still running, or queued to run.
const STATUS_WORDS = { failing: "failing", pending: "running", passing: "passing" } as const satisfies Record<CheckOutcome, string>;

/** `N failing`, else `N running`, else `N passing`: only failing is coloured. */
export function ChecksStatus({ checks }: { checks: Check[] }) {
  const { outcome, count } = leadingOutcome(summarizeChecks(checks));
  return (
    <p className={`text-xs tabular-nums ${outcome === "failing" ? "text-destructive-text" : "text-muted-foreground"}`}>
      {count} {STATUS_WORDS[outcome]}
    </p>
  );
}

// The hidden checks continue the list above the button, so the open list reads in one order.
function MoreDisclosure({ more, toggle }: { more: Check[]; toggle: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <div id={listId} hidden={!open}>
        <CheckRows checks={more} />
      </div>
      {/* -ml-2.5 lines the label, not the button's padding, up with the rows. */}
      <div className="mt-1 -ml-2.5">
        <Button ref={toggle} variant="ghost" size="small" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          {open ? "Hide" : `Show ${more.length} more`}
        </Button>
      </div>
    </>
  );
}

function CheckRows({ checks }: { checks: Check[] }) {
  const keys = rowKeys(checks);
  return (
    <ul>
      {checks.map((check, index) => (
        <li key={keys[index]}>
          <CheckRow check={check} />
        </li>
      ))}
    </ul>
  );
}

// Each row keyed by its check, so a refresh that moves a check away takes its row, and any focus on
// it, along. A name alone can repeat (two workflows can each run a check of the same name), so the
// key adds the URL, and numbers checks that share both in the order they come.
function rowKeys(checks: Check[]): string[] {
  const seen = new Map<string, number>();
  return checks.map(({ name, url }) => {
    const identity = JSON.stringify([name, url]);
    const repeat = seen.get(identity) ?? 0;
    seen.set(identity, repeat + 1);
    return `${identity}#${repeat}`;
  });
}

const ROW = "flex min-h-[26px] min-w-0 items-center gap-2 text-[12.5px]";

function CheckRow({ check }: { check: Check }) {
  const content: ReactNode = (
    <>
      <CheckOutcomeIcon outcome={check.outcome} />
      <span className="min-w-0 truncate">{check.name}</span>
      <span className="sr-only">, {check.outcome}</span>
    </>
  );
  if (check.url === null) return <span className={ROW}>{content}</span>;
  return (
    <UrlLink
      href={check.url}
      className={`${ROW} rounded-sm decoration-foreground/35 underline-offset-[3px] hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none`}
    >
      {content}
    </UrlLink>
  );
}
