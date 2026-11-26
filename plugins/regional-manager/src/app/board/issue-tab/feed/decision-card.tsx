// A decision in an issue's feed, full size between its rounds: a question the regional manager put to
// the user about the issue, with its options and the user's answer; or a decision it recorded on the
// issue. An open question's options are buttons that answer it here, as on the Board.
import { useLayoutEffect, useRef } from "react";
import type { IssueDecision } from "../../../../model/decision.ts";
import { isClosed } from "../../../../model/issue/relations.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../../model/issue/status.ts";
import { stillWaits } from "../../../../model/verdict/rounds/cap.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { Button } from "../../../ui/button.tsx";
import { useAnswer } from "../../use-answer.ts";
import { ManagerName, MovedTo, When } from "./byline.tsx";
import { ResultGlyph } from "./round/result-glyph.tsx";

type Asked = Extract<IssueDecision, { kind: "asked" }>;

/** `moved`: the status the issue moved to after it (null: none); `status`: the issue's status now. */
export function DecisionCard({ coordinatorId, decision, moved, status }: { coordinatorId: CoordinatorId; decision: IssueDecision; moved: IssueStatus | null; status: IssueStatus }) {
  switch (decision.kind) {
    case "asked":
      return <Question coordinatorId={coordinatorId} decision={decision} moved={moved} status={status} />;
    case "recorded":
      return (
        <article className="rmi-decision" aria-label="Decision">
          <p className="rmi-decision-head">
            <ManagerName coordinatorId={coordinatorId} /> decided
            <MovedTo status={moved} /> <When at={decision.at} />
          </p>
          <p className="rmi-decision-text">{decision.text}</p>
        </article>
      );
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      decision satisfies never;
      return null;
  }
}

/**
 * A question put to the user: open, a button per option that answers it; answered, its options with
 * the one chosen marked, and the answer; lapsed, its options and why none takes an answer. One
 * component for all three, so the card stays as the options go, and focus on an option, which
 * unmounts then, moves to the card, whatever took them: an answer from this card, the Board or
 * another window, or the issue's close.
 */
function Question({ coordinatorId, decision, moved, status }: { coordinatorId: CoordinatorId; decision: Asked; moved: IssueStatus | null; status: IssueStatus }) {
  const { sent, send, error } = useAnswer(coordinatorId, decision.id);
  const card = useRef<HTMLElement>(null);
  // Whether focus is on one of the options. why a ref: whatever unmounts them fires no blur.
  const onOption = useRef(false);
  const answered = decision.answer !== null;
  const takesAnswer = stillWaits(decision, isClosed(status));
  // why an effect: focus is the browser's, and the option it was on is gone only once this commit lands.
  useLayoutEffect(() => {
    if (takesAnswer || !onOption.current) return;
    onOption.current = false;
    if (document.activeElement === null || document.activeElement === document.body) card.current?.focus();
  }, [takesAnswer]);
  return (
    <article ref={card} tabIndex={-1} className="rmi-decision" aria-label={`Question ${decision.id}`}>
      <p className="rmi-decision-head">
        {/* why by its cap: the plugin itself asks at an issue's cap of failed verifications (rounds/cap.ts), not the regional manager. */}
        {decision.cap === null ? <ManagerName coordinatorId={coordinatorId} /> : <span className="rmi-actor">The plugin</span>} asked you
        <MovedTo status={moved} /> <When at={decision.at} />
        <span className="rmi-decision-id">{decision.id}</span>
      </p>
      <p className="rmi-decision-text">{decision.question}</p>
      {decision.answer !== null ? (
        <Answer decision={decision} answer={decision.answer} />
      ) : takesAnswer ? (
        <Options decision={decision} sent={sent} send={send} onFocusChange={(focused) => (onOption.current = focused)} />
      ) : (
        <Lapsed decision={decision} status={status} />
      )}
      {sent !== null && !answered && (
        <p role="status" className="rmi-verdict-meta">
          Sending your answer…
        </p>
      )}
      {error !== null && (
        <p role="alert" className="rmi-decision-error">
          Could not send your answer: {error.message}
        </p>
      )}
    </article>
  );
}

/** Waiting for the user: each option answers it; one with no options is answered in words, on the Board. */
type OptionsProps = { decision: Asked; sent: string | null; send(text: string): void; onFocusChange(focused: boolean): void };

function Options({ decision, sent, send, onFocusChange }: OptionsProps) {
  if (decision.options.length === 0) return <p className="rmi-verdict-meta">Answer it in your own words under Needs you on the Board.</p>;
  return (
    <ul
      aria-label="Options"
      className="rmi-options"
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => onFocusChange(event.currentTarget.contains(event.relatedTarget))}
    >
      {decision.options.map((option) => (
        <li key={option} className="max-w-full">
          {/* why aria-disabled, not disabled: a disabled button drops focus to the page while the answer sends. */}
          <Button variant="secondary" size="sm-wrap" aria-disabled={sent !== null} onClick={() => send(option)}>
            {option}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** A question at the issue's cap that the issue's close left unanswered: its options, none to press, and why. */
function Lapsed({ decision, status }: { decision: Asked; status: IssueStatus }) {
  return (
    <>
      {decision.options.length > 0 && (
        <ul aria-label="Options" className="rmi-options">
          {decision.options.map((option) => (
            <li key={option} className="rmi-option">
              {option}
            </li>
          ))}
        </ul>
      )}
      <p className="rmi-verdict-meta">Not answered: the issue is {STATUS_LABELS[status]}, so no round is left for an answer to allow.</p>
    </>
  );
}

function Answer({ decision, answer }: { decision: Asked; answer: NonNullable<Asked["answer"]> }) {
  return (
    <>
      {decision.options.length > 0 && (
        <ul aria-label="Options" className="rmi-options">
          {decision.options.map((option) => (
            <li key={option} className="rmi-option" data-chosen={option === answer.text || undefined}>
              {option === answer.text && <ResultGlyph result="pass" />}
              {option}
              {option === answer.text && <span className="sr-only">, your answer</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="rmi-decision-head rmi-decision-reply">
        <span className="rmi-actor">You</span> answered <When at={answer.at} />
      </p>
      <p className="rmi-decision-text">{answer.text}</p>
    </>
  );
}
