// What a manager's hover card says: its avatar and name, its description when it has one, its state
// and since when, its project; then, under a rule, its open work (issue-section.tsx), read only while
// the card shows. No machine, branch or subthreads: a manager's work is its issues. A list that can't be
// read, or a manager with nothing waiting on the user and nothing under way, leaves the card without it.
import { issueList } from "./issue-list.ts";
import { stateLine } from "../../../card/state-line.ts";
import { useManagerIssues } from "../../../data/managers/use-manager-issues.ts";
import { useAsk } from "../../../data/use-asks.ts";
import { useMinute } from "../../../data/use-minute.ts";
import type { ManagerModel } from "../../../model/activity.ts";
import { withAsk } from "../../../model/state.ts";
import { CardGlyph } from "../../card/card-glyphs.tsx";
import { Line, StateLineView } from "../../card/card-lines.tsx";
import { useFocusKept } from "../../card/use-focus-kept.ts";
import { IssueSection } from "./issue-section.tsx";
import { ManagerAvatar } from "../manager-avatar.tsx";

/** The card's avatar, beside the title's first line. */
const FACE = 20;

type Props = { manager: ManagerModel; underWaySince: ReadonlyMap<string, number>; onOpen(): void };

export function ManagerCardBody({ manager, underWaySince, onOpen }: Props) {
  const t = manager.thread;
  const now = useMinute();
  const ask = useAsk(t);
  const look = manager.look;
  const state = manager.state === null ? null : withAsk(manager.state, ask);
  const line = stateLine({ thread: t, asleepUntil: null }, state, underWaySince.get(t.id) ?? t.updatedAt, now);
  const work = useManagerIssues(look?.id ?? null);
  const list = work === null ? null : issueList(work);
  const kept = useFocusKept();

  return (
    <>
      <div className="as-card-head">
        <ManagerAvatar avatar={look?.avatar ?? null} following="off" size={FACE} />
        <div className="as-card-title">{t.displayTitle}</div>
      </div>
      {look !== null && look.description !== null && <p className="as-card-desc">{look.description}</p>}
      <div className="as-card-lines">
        <StateLineView line={line} />
        <Line glyph={<CardGlyph name="folder" />}>{manager.project}</Line>
      </div>
      {/* why always there, hidden while empty (app.css): a refresh that takes the list away leaves focus
          that was in it to the card, which needs the body to see it go (use-focus-kept.ts). The keyboard
          scrolls only what has focus, as on the threads' card. */}
      <div {...kept} className="as-card-body" tabIndex={0}>
        {look !== null && list !== null && (
          <>
            <div className="as-card-rule" />
            <IssueSection list={list} coordinatorId={look.id} boardHref={t.href} onOpen={onOpen} />
          </>
        )}
      </div>
    </>
  );
}
