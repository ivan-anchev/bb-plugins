// One sidebar section: a sticky heading with its count, then its PRs and stacks, or one quiet line
// when it has none.
import { useId } from "react";
import type { InboxPr, Section } from "../../contract.ts";
import { attentionOf, type Visits } from "./attention.ts";
import { ListedRow } from "./pr-row.tsx";
import { SECTION_TEXT } from "./section-text.ts";
import { StackTree } from "./stack-tree.tsx";

export type RowActions = { isOpen(pr: InboxPr): boolean; open(pr: InboxPr): void };

export function InboxSection({ section, visits, isOpen, open }: RowActions & { section: Section; visits: Visits }) {
  const headingId = useId();
  const { title, empty } = SECTION_TEXT[section.key];
  return (
    <section aria-labelledby={headingId} className="[&+&]:mt-2">
      <h2 id={headingId} className="sticky top-0 z-10 -mx-1.5 flex items-baseline gap-1.5 bg-sidebar px-4 pt-2 pb-1 text-[11px] leading-4 font-medium text-subtle-foreground">
        {title}
        <span className="font-normal tabular-nums">{section.count}</span>
      </h2>
      {section.items.length === 0 ? (
        <p className="px-2.5 pt-1 pb-2 text-xs leading-4 text-subtle-foreground">{empty}</p>
      ) : (
        <ul>
          {section.items.map((item) =>
            item.kind === "pr" ? (
              <li key={`${item.pr.repo}#${item.pr.number}`}>
                <ListedRow
                  pr={item.pr}
                  stack={item.stack}
                  attention={attentionOf(item.pr, section.key, visits)}
                  current={isOpen(item.pr)}
                  onOpen={() => open(item.pr)}
                />
              </li>
            ) : (
              <li key={`${item.members[0].repo}#${item.members[0].number}`}>
                <StackTree members={item.members} section={section.key} visits={visits} isOpen={isOpen} open={open} />
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
