import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { InboxPr, SectionKey } from "../../contract.ts";
import { attentionOf, type Visits } from "./attention.ts";
import type { RowActions } from "./inbox-section.tsx";
import { ListedRow, StackMateRow } from "./pr-row.tsx";

type StackTreeProps = RowActions & { members: InboxPr[]; section: SectionKey; visits: Visits };

const RAIL = "[--rail:var(--border)] has-[button:hover]:[--rail:var(--muted-foreground)] has-[[aria-current=page]]:[--rail:var(--muted-foreground)]";

const MEMBER =
  "relative pl-4 before:absolute before:inset-y-0 before:left-4.5 before:w-px before:bg-[var(--rail)] after:absolute after:top-1/2 after:left-4.5 after:h-px after:w-1.5 after:bg-[var(--rail)] last:before:bottom-1/2 last:before:w-1.5 last:before:rounded-bl-sm last:before:border-b last:before:border-l last:before:border-[var(--rail)] last:before:bg-transparent last:after:hidden";

export function StackTree({ members, section, visits, isOpen, open }: StackTreeProps) {
  const [bottom] = members;
  const here = members.filter((pr) => pr.section === section).length;
  return (
    <ul role="group" aria-label={`Stack #${bottom.number} in ${bottom.repo}, ${here} of ${members.length} pull requests here`} className={`my-0.5 ${RAIL}`}>
      <li aria-hidden className="grid h-6 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 pr-2 pl-2.5 text-xs leading-4 text-muted-foreground">
        <span className="flex size-5.5 items-center justify-center justify-self-center rounded-md bg-secondary">
          <Icon name="Layers" className="size-3.5 text-muted-foreground" aria-hidden />
        </span>
        <span className="truncate">Stack #{bottom.number}</span>
        <span className="text-xs text-subtle-foreground tabular-nums">
          {here} of {members.length}
        </span>
      </li>
      {[...members].reverse().map((pr) => (
        <li key={pr.number} className={MEMBER}>
          {pr.section === section ? (
            <ListedRow pr={pr} stack={null} attention={attentionOf(pr, section, visits)} current={isOpen(pr)} onOpen={() => open(pr)} />
          ) : (
            <StackMateRow pr={pr} current={isOpen(pr)} onOpen={() => open(pr)} />
          )}
        </li>
      ))}
    </ul>
  );
}
