import { useId } from "react";
import type { InboxPr, Section } from "../../contract.ts";
import { attentionOf, type Visits } from "./attention.ts";
import { ListedRow } from "./pr-row.tsx";
import { SECTION_TEXT } from "./section-text.ts";
import { StackTree } from "./stack-tree.tsx";

const SECTION_TITLE = "text-[11px] leading-3.5 font-medium whitespace-nowrap text-subtle-foreground";
const FOLD =
  "flex h-full w-full cursor-pointer items-center gap-2 rounded-md px-2.5 hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset";

export type RowActions = { isOpen(pr: InboxPr): boolean; open(pr: InboxPr): void };

type InboxSectionProps = RowActions & { section: Section; visits: Visits; folded: boolean; onFold(folded: boolean): void };

export function InboxSection({ section, visits, isOpen, open, folded, onFold }: InboxSectionProps) {
  const headingId = useId();
  const bodyId = useId();
  const { title, empty } = SECTION_TEXT[section.key];
  return (
    <section aria-labelledby={headingId} className="[&+&]:mt-2">
      <h2 id={headingId} className={`sticky top-0 z-10 -mx-1.5 h-6 bg-background px-1.5 ${SECTION_TITLE}`}>
        <button type="button" aria-expanded={!folded} aria-controls={bodyId} onClick={() => onFold(!folded)} className={FOLD}>
          {title}
          <span className="tabular-nums">{section.count}</span>
        </button>
      </h2>
      {folded ? null : section.items.length === 0 ? (
        <p id={bodyId} className="px-2.5 pt-1 pb-2 text-xs leading-4 text-subtle-foreground">{empty}</p>
      ) : (
        <ul id={bodyId}>
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
