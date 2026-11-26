// A question that takes no answer any more, in its card: answered, its options with the one chosen
// marked, or the user's own words once under them; lapsed, its options and why none takes an answer.
// The rows keep the open card's shape, so the choice reads as the row the user pressed.
import type { AskedDecision } from "../../../../../model/decision.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../../../model/issue/status.ts";
import { shortTime } from "../../../../ui/time.ts";
import { When } from "../byline.tsx";
import { ResultGlyph } from "../round/result-glyph.tsx";

type Answered = NonNullable<AskedDecision["answer"]>;

/** The option an answer chose, by its place among the options, and when it was chosen. */
type Chosen = { index: number; at: number };

/**
 * An answered question: an answer that is one of its options shows only as that option marked; one
 * in the user's own words, which no option matches, shows once, under the options.
 */
export function Answer({ decision, answer }: { decision: AskedDecision; answer: Answered }) {
  // why one match, by index: it marks the option and hides the words, so neither can disagree with the other.
  const index = decision.options.findIndex((option) => option === answer.text);
  const chosen = index === -1 ? null : { index, at: answer.at };
  return (
    <>
      <SettledRows options={decision.options} chosen={chosen} />
      {chosen === null && (
        <div className="rmi-q-reply">
          <p className="rmi-decision-head">
            <span className="rmi-actor">You</span> answered <When at={answer.at} />
          </p>
          <p className="rmi-decision-text">{answer.text}</p>
        </div>
      )}
    </>
  );
}

/** A question at the issue's cap that the issue's close left unanswered: its options, none to press, and why. */
export function Lapsed({ decision, status }: { decision: AskedDecision; status: IssueStatus }) {
  return (
    <>
      <SettledRows options={decision.options} chosen={null} />
      <p className="rmi-verdict-meta">Not answered: the issue is {STATUS_LABELS[status]}, so no round is left for an answer to allow.</p>
    </>
  );
}

/** Rows none can press, the one the user chose (null: none) marked, with when they chose it on hover and in its name. */
function SettledRows({ options, chosen }: { options: readonly string[]; chosen: Chosen | null }) {
  if (options.length === 0) return null;
  return (
    <ul aria-label="Options" className="rmi-q-rows" data-settled>
      {options.map((option, index) =>
        index === chosen?.index ? (
          <li key={option} className="rmi-q-row" data-chosen title={`Your answer, ${shortTime(chosen.at)}`}>
            <span className="rmi-q-key">
              <ResultGlyph result="pass" />
            </span>
            <span className="rmi-q-label">{option}</span>
            <span className="sr-only">
              , your answer, <When at={chosen.at} />
            </span>
          </li>
        ) : (
          <li key={option} className="rmi-q-row">
            <span className="rmi-q-key" />
            <span className="rmi-q-label">{option}</span>
          </li>
        ),
      )}
    </ul>
  );
}
