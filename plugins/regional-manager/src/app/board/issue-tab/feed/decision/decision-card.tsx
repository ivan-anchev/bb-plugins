// A decision in an issue's feed, between its rounds: a question the regional manager put to the user
// about the issue, with its options and the user's answer; or a decision it recorded on the issue,
// its first sentence whole and the rest cut to two lines, opening on press. An open question is
// answered here, from its numbered rows: an option, or the user's own words. Asked from its issue's
// row under Needs you, an open one scrolls to the middle of the tab, rings briefly, and takes focus
// on its first row.
import "./decision.css";
import { useEffect, useRef, type AnimationEvent } from "react";
import type { AskedDecision, IssueDecision } from "../../../../../model/decision.ts";
import { isClosed } from "../../../../../model/issue/relations.ts";
import type { IssueStatus } from "../../../../../model/issue/status.ts";
import { stillWaits } from "../../../../../model/verdict/rounds/cap.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import { firstMarkdownSentence } from "../../../../ui/tab-markdown/markdown-source.ts";
import { TabMarkdown } from "../../../../ui/tab-markdown/tab-markdown.tsx";
import { useAnswer } from "../../../use-answer.ts";
import { ManagerName, When } from "../byline.tsx";
import { Clamp } from "../clamp.tsx";
import { OpenRows, pressAnswerKey } from "./open-rows.tsx";
import { Answer, Lapsed } from "./settled-rows.tsx";

/** `status`: the issue's status now; `onRevealed`, for a question asked to be shown, called once it showed (null: none asked). */
type DecisionCardProps = { coordinatorId: CoordinatorId; decision: IssueDecision; status: IssueStatus; onRevealed: (() => void) | null };

export function DecisionCard({ coordinatorId, decision, status, onRevealed }: DecisionCardProps) {
  switch (decision.kind) {
    case "asked":
      return <Question coordinatorId={coordinatorId} decision={decision} status={status} onRevealed={onRevealed} />;
    case "recorded":
      return (
        <article className="rmi-decision" aria-label="Decision">
          <p className="rmi-decision-head">
            <ManagerName coordinatorId={coordinatorId} /> decided <When at={decision.at} />
          </p>
          <Decided text={decision.text} />
        </article>
      );
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      decision satisfies never;
      return null;
  }
}

/**
 * A question put to the user: open, its numbered rows answer it; answered, its options with the one
 * chosen marked, or an answer in the user's own words under them; lapsed, its options and why none
 * takes an answer. One component for all three, so the card stays as the rows go, and takes the focus
 * they held as they leave (open-rows.tsx), whatever took them: an answer from this card, the Board or
 * another window, or the issue's close.
 */
function Question({ coordinatorId, decision, status, onRevealed }: Omit<DecisionCardProps, "decision"> & { decision: AskedDecision }) {
  const { sent, send, error } = useAnswer(coordinatorId, decision.id);
  const takesAnswer = stillWaits(decision, isClosed(status));
  const card = useRevealed(onRevealed);
  return (
    <article ref={card} tabIndex={-1} className="rmi-decision" aria-label={`Question ${decision.id}`} onKeyDown={takesAnswer ? pressAnswerKey : undefined} onAnimationEnd={ringGone}>
      <p className="rmi-decision-head">
        {/* why by its cap: the plugin itself asks at an issue's cap of failed verifications (rounds/cap.ts), not the regional manager. */}
        {decision.cap === null ? <ManagerName coordinatorId={coordinatorId} /> : <span className="rmi-actor">The plugin</span>} asked you <When at={decision.at} />
      </p>
      <p className="rmi-decision-text">{decision.question}</p>
      {decision.answer !== null ? (
        <Answer decision={decision} answer={decision.answer} />
      ) : takesAnswer ? (
        <OpenRows coordinatorId={coordinatorId} decision={decision} sent={sent} send={send} />
      ) : (
        <Lapsed decision={decision} status={status} />
      )}
      {error !== null && (
        <p role="alert" className="rmi-decision-error">
          Could not send your answer: {error.message}
        </p>
      )}
    </article>
  );
}

/**
 * The card's ref, which shows it once `onRevealed` asks: scrolled to the middle of the tab, ringed
 * (decision.css), focus on its first row, the one numbered 1; then `onRevealed` is called. why an
 * effect and the DOM's own attribute: scrolling and focus are the browser's, and the ring goes when
 * its animation ends (ringGone), with no render between.
 */
function useRevealed(onRevealed: (() => void) | null) {
  const card = useRef<HTMLElement>(null);
  useEffect(
    function reveal() {
      const shown = card.current;
      if (onRevealed === null || shown === null) return;
      shown.scrollIntoView({ block: "center" });
      shown.dataset.revealed = "";
      (shown.querySelector<HTMLElement>("[aria-keyshortcuts]") ?? shown).focus(FOCUS_SHOWN);
      onRevealed();
    },
    [onRevealed],
  );
  return card;
}

/**
 * Focus on the first row, kept where the scroll put it and drawn as from the keyboard. why
 * focusVisible: the row was reached by pressing the Board's row, and a browser shows no ring for
 * focus a press moved, so the user wouldn't see which row their number keys start from. TypeScript's
 * DOM types lack the option; Chromium, which bb runs in, takes it.
 */
const FOCUS_SHOWN: FocusOptions & { focusVisible: boolean } = { preventScroll: true, focusVisible: true };

/** Takes the ring off once its animation ends. why its own target only: a spinner's turn in the card ends no ring. */
function ringGone(event: AnimationEvent<HTMLElement>) {
  if (event.target === event.currentTarget) delete event.currentTarget.dataset.revealed;
}

/** A recorded decision's words, as Markdown: its first sentence, its headline, whole, cut where no link or code runs across; the rest, if any, muted and cut to two lines. */
function Decided({ text }: { text: string }) {
  const { sentence, rest } = firstMarkdownSentence(text);
  return (
    <div>
      <div className="rmi-decision-text">
        <TabMarkdown text={sentence} />
      </div>
      {rest !== null && (
        <Clamp lines={2} className="rmi-decision-rest">
          <TabMarkdown text={rest} />
        </Clamp>
      )}
    </div>
  );
}
