// A decision in an issue's feed, between its rounds: a question the regional manager put to the user
// about the issue, with its options and the user's answer; or a decision it recorded on the issue,
// its first sentence whole and the rest cut to two lines, opening on press. An open question is
// answered here, from its numbered rows: an option, or the user's own words.
import "./decision.css";
import type { AskedDecision, IssueDecision } from "../../../../../model/decision.ts";
import { isClosed } from "../../../../../model/issue/relations.ts";
import type { IssueStatus } from "../../../../../model/issue/status.ts";
import { firstSentence } from "../../../../../model/one-line.ts";
import { stillWaits } from "../../../../../model/verdict/rounds/cap.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import { useAnswer } from "../../../use-answer.ts";
import { ManagerName, When } from "../byline.tsx";
import { Clamp } from "../clamp.tsx";
import { OpenRows, pressAnswerKey } from "./open-rows.tsx";
import { Answer, Lapsed } from "./settled-rows.tsx";

/** `status`: the issue's status now. */
export function DecisionCard({ coordinatorId, decision, status }: { coordinatorId: CoordinatorId; decision: IssueDecision; status: IssueStatus }) {
  switch (decision.kind) {
    case "asked":
      return <Question coordinatorId={coordinatorId} decision={decision} status={status} />;
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
function Question({ coordinatorId, decision, status }: { coordinatorId: CoordinatorId; decision: AskedDecision; status: IssueStatus }) {
  const { sent, send, error } = useAnswer(coordinatorId, decision.id);
  const takesAnswer = stillWaits(decision, isClosed(status));
  return (
    <article tabIndex={-1} className="rmi-decision" aria-label={`Question ${decision.id}`} onKeyDown={takesAnswer ? pressAnswerKey : undefined}>
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

/** A recorded decision's words: its first sentence, its headline, whole; the rest, if any, muted and cut to two lines. */
function Decided({ text }: { text: string }) {
  const { sentence, rest } = firstSentence(text);
  return (
    <div>
      <p className="rmi-decision-text">{sentence}</p>
      {rest !== null && (
        <Clamp lines={2} className="rmi-decision-rest">
          {rest}
        </Clamp>
      )}
    </div>
  );
}
