// The side panel's checks: the count line, then the failing and pending checks, then the passing
// ones behind a disclosure. Each check with a details page links to it, opened outside the app the
// way the header's GitHub button is; one without is plain text.
import { useId, useState, type ReactNode, type RefObject } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { summarizeChecks, type Check, type CheckOutcome, type ChecksSummary } from "../../contract.ts";
import { Button } from "../ui/button.tsx";
import { CheckOutcomeIcon } from "./check-outcome-icon.tsx";

// `toggle` takes the passing list's button: the side panel moves focus there when a refresh moves the
// focused check into the passing list.
export function CheckList({ checks, toggle }: { checks: Check[]; toggle: RefObject<HTMLButtonElement | null> }) {
  const urgent = [...withOutcome(checks, "failing"), ...withOutcome(checks, "pending")];
  const passing = withOutcome(checks, "passing");
  return (
    <>
      <CountLine summary={summarizeChecks(checks)} />
      {urgent.length > 0 && <CheckRows checks={urgent} />}
      {passing.length > 0 && <PassingDisclosure passing={passing} toggle={toggle} />}
    </>
  );
}

const withOutcome = (checks: Check[], outcome: CheckOutcome) => checks.filter((check) => check.outcome === outcome);

// `N failing · N pending · N passing`: a zero failing or pending count is left out, passing never.
function CountLine({ summary: { failing, pending, passing } }: { summary: ChecksSummary }) {
  return (
    <p className="mb-1 text-xs text-muted-foreground tabular-nums">
      {failing > 0 && (
        <>
          <span className="text-destructive-text">{failing} failing</span> ·{" "}
        </>
      )}
      {pending > 0 && `${pending} pending · `}
      {passing} passing
    </p>
  );
}

function PassingDisclosure({ passing, toggle }: { passing: Check[]; toggle: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      {/* -ml-2.5 lines the label, not the button's padding, up with the rows. */}
      <div className="mt-1 -ml-2.5">
        <Button ref={toggle} variant="ghost" size="small" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          {open ? "Hide passing" : `Show ${passing.length} passing`}
        </Button>
      </div>
      <div id={listId} hidden={!open}>
        <CheckRows checks={passing} />
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
