// A decision in an issue's feed, full size between its rounds: a question the regional manager put to
// the user about the issue, with its options and the user's answer; or a decision it recorded on the
// issue. An open question's options are buttons that answer it here, as on the Board.
import type { IssueDecision } from "../../../../model/decision.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { Button } from "../../../ui/button.tsx";
import { useAnswer } from "../../use-answer.ts";
import { When } from "./byline.tsx";
import { ResultGlyph } from "./round/result-glyph.tsx";

type Asked = Extract<IssueDecision, { kind: "asked" }>;

export function DecisionCard({ coordinatorId, decision }: { coordinatorId: CoordinatorId; decision: IssueDecision }) {
  switch (decision.kind) {
    case "asked":
      return decision.answer === null ? <OpenQuestion coordinatorId={coordinatorId} decision={decision} /> : <Answered decision={decision} answer={decision.answer} />;
    case "recorded":
      return (
        <article className="rmi-decision" aria-label="Decision">
          <p className="rmi-decision-head">
            <span className="rmi-actor">Regional manager</span> decided <When at={decision.at} />
          </p>
          <p className="rmi-decision-text">{decision.text}</p>
        </article>
      );
    default:
      return decision satisfies never;
  }
}

function Question({ decision }: { decision: Asked }) {
  return (
    <>
      <p className="rmi-decision-head">
        <span className="rmi-actor">Regional manager</span> asked you <When at={decision.at} />
        <span className="rmi-decision-id">{decision.id}</span>
      </p>
      <p className="rmi-decision-text">{decision.question}</p>
    </>
  );
}

/** Waiting for the user: each option answers it; one with no options is answered in words, on the Board. */
function OpenQuestion({ coordinatorId, decision }: { coordinatorId: CoordinatorId; decision: Asked }) {
  const { sent, send, error } = useAnswer(coordinatorId, decision.id);
  return (
    <article className="rmi-decision" aria-label={`Question ${decision.id}`} data-open>
      <Question decision={decision} />
      {decision.options.length > 0 ? (
        <ul aria-label="Options" className="rmi-options">
          {decision.options.map((option) => (
            <li key={option} className="max-w-full">
              {/* why aria-disabled, not disabled: a disabled button drops focus to the page while the answer sends. */}
              <Button variant="secondary" size="sm-wrap" aria-disabled={sent !== null} onClick={() => send(option)}>
                {option}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rmi-verdict-meta">Answer it in your own words under Needs you on the Board.</p>
      )}
      {sent !== null && (
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

function Answered({ decision, answer }: { decision: Asked; answer: NonNullable<Asked["answer"]> }) {
  return (
    <article className="rmi-decision" aria-label={`Question ${decision.id}`}>
      <Question decision={decision} />
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
    </article>
  );
}
