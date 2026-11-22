import { useId, useState, type ReactNode, type RefObject } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { leadingOutcome, summarizeChecks, type Check, type CheckOutcome } from "../../contract.ts";
import { Button } from "../ui/button.tsx";
import { LINK } from "../ui/link.ts";
import { CheckOutcomeIcon } from "./check-outcome-icon.tsx";

const ALWAYS_SHOWN = 3;

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

const PRIORITY = ["failing", "pending", "passing"] as const satisfies readonly CheckOutcome[];
const byPriority = (checks: Check[]): Check[] => PRIORITY.flatMap((outcome) => checks.filter((check) => check.outcome === outcome));

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

function MoreDisclosure({ more, toggle }: { more: Check[]; toggle: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <div id={listId} hidden={!open}>
        <CheckRows checks={more} />
      </div>
      <div className="mt-1 -ml-2.5">
        <Button ref={toggle} variant="ghost" size="sm" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
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

function rowKeys(checks: Check[]): string[] {
  const seen = new Map<string, number>();
  return checks.map(({ name, url }) => {
    const identity = JSON.stringify([name, url]);
    const repeat = seen.get(identity) ?? 0;
    seen.set(identity, repeat + 1);
    return `${identity}#${repeat}`;
  });
}

const ROW = "flex min-h-7 min-w-0 items-center gap-2 text-xs";

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
      className={`${ROW} ${LINK}`}
    >
      {content}
    </UrlLink>
  );
}
