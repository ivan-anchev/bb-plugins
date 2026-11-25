// A manager's card's list (card/issue-list.ts): "Needs you N", then "In progress N", headings of words
// and a count only; under each, its lines, the thread card's subthread lines in grammar: the issue's
// glyph in the 20 slot, its id, its title fading out. A sub-issue hangs on a hairline under its parent;
// a parent there only for its sub-issues is quiet. A press opens the issue's tab in the manager's
// thread; a decision's opens the thread, where the manager's Board asks it. "+N more" says what the cap left out,
// and is no control.
import type { IssueLine, IssueList } from "./issue-list.ts";
import { STATUS_LABELS } from "../../../model/manager-issues.ts";
import { Rails } from "../../card/rails.tsx";
import { FadingTitle } from "../../row/row.tsx";
import { IssueGlyph } from "./issue-glyph.tsx";

/** `coordinatorId` names the manager in its issues' links; `boardHref` is its thread, from whose Board its decisions are answered. */
type Props = { list: IssueList; coordinatorId: string; boardHref: string; onOpen(): void };

export function IssueSection({ list, coordinatorId, boardHref, onOpen }: Props) {
  return (
    <>
      {list.groups.map((group) => (
        <div key={group.name} className="as-card-sub">
          <div className="as-card-sub-head">
            {group.name}
            <span>{group.count}</span>
          </div>
          <div>
            {group.lines.map((line) => (
              <div key={`${line.kind}:${line.id}`} className="as-mini" data-context={(line.kind === "issue" && line.context) || undefined}>
                {line.kind === "issue" ? <IssueLineView line={line} href={issueHref(coordinatorId, line.id)} onOpen={onOpen} /> : <DecisionLine line={line} href={boardHref} onOpen={onOpen} />}
              </div>
            ))}
          </div>
        </div>
      ))}
      {list.hidden > 0 && <div className="as-card-more">+{list.hidden} more</div>}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

type IssueLineOf = Extract<IssueLine, { kind: "issue" }>;
type DecisionLineOf = Extract<IssueLine, { kind: "decision" }>;

/** The parent's glyph's middle, which a sub-issue's hairline hangs from, and where the sub-issue's line starts. */
const TRUNK = 10;
const NESTED = 18;

function IssueLineView({ line, href, onOpen }: { line: IssueLineOf; href: string; onOpen(): void }) {
  const said = line.reason === null ? STATUS_LABELS[line.status] : `Needs you: ${line.reason}`;
  return (
    <>
      {line.nested && (
        <>
          <Rails rail={{ at: TRUNK, indent: NESTED, last: line.last, through: [] }} />
          <span className="as-mini-pad" style={{ width: NESTED }} />
        </>
      )}
      <a className="as-mini-body" href={href} title={said} aria-label={`${line.id} ${line.title}, ${said}`} onClick={onOpen}>
        <span className="as-mini-slot">
          <IssueGlyph mark={line.reason === null ? line.status : "needs-you"} />
        </span>
        <span className="as-issue-id">{line.id}</span>
        <FadingTitle text={line.title} />
      </a>
    </>
  );
}

function DecisionLine({ line, href, onOpen }: { line: DecisionLineOf; href: string; onOpen(): void }) {
  return (
    <a className="as-mini-body" href={href} title="Needs you: your answer" aria-label={`${line.question}, needs your answer`} onClick={onOpen}>
      <span className="as-mini-slot">
        <IssueGlyph mark="needs-you" />
      </span>
      <FadingTitle text={line.question} />
    </a>
  );
}

/** The issue's tab in its manager's thread, beside the Board: the Regional Manager plugin's route for it, which bb routes in place. */
const issueHref = (coordinatorId: string, issueId: string): string => `/plugins/regional-manager/regional-managers/issue/${coordinatorId}/${issueId}`;
