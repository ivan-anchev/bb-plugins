import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { IssueDecision } from "../../../../model/decision.ts";
import { shortTime } from "../../../ui/time.ts";

export function IssueDecisions({ decisions }: { decisions: readonly IssueDecision[] }) {
  return (
    <ol className="rmi-decisions">
      {decisions.map((decision, i) => (
        <li key={i} className="rmi-decision">
          <Entry decision={decision} />
        </li>
      ))}
    </ol>
  );
}

function Entry({ decision }: { decision: IssueDecision }) {
  switch (decision.kind) {
    case "asked": {
      const { id, question, at, answer } = decision;
      return (
        <>
          <p className="rmi-decision-text">
            <span className="rmi-id mr-1.5">{id}</span>
            {question}
          </p>
          {answer === null ? (
            <p className="rmi-decision-meta">
              Waiting for your answer · asked <When at={at} />
            </p>
          ) : (
            <p className="rmi-decision-answer">
              <Icon name="CornerDownRight" aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0">
                <span className="sr-only">You answered: </span>
                <span className="text-foreground">{answer.text}</span> · <When at={answer.at} />
              </span>
            </p>
          )}
        </>
      );
    }
    case "recorded":
      return (
        <>
          <p className="rmi-decision-text">{decision.text}</p>
          <p className="rmi-decision-meta">
            Recorded by the regional manager · <When at={decision.at} />
          </p>
        </>
      );
    default:
      return decision satisfies never;
  }
}

const When = ({ at }: { at: number }) => <time dateTime={new Date(at).toISOString()}>{shortTime(at)}</time>;
