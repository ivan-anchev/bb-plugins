// Tests only, in Chrome (chrome.test.ts): an issue's feed's cards, as its Activity draws them: a
// decision whose first sentence runs long, one a list follows, comments holding HTML examples, and a
// sweep of decisions whose first sentences end one letter further along each.
import "../feed.css";
import { coordinatorContract } from "../../../../../contract.ts";
import { commentIdSchema } from "../../../../../model/feed/comment.ts";
import { issueIdSchema } from "../../../../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../../../../model/role.ts";
import { draw } from "../../../../test-chrome-page.tsx";
import { CommentCard } from "../comment-card.tsx";
import { DecisionCard } from "../decision/decision-card.tsx";
import { ADJACENT_TAGS, HTML_EXAMPLE, LIST_FIRST, LONG_FIRST_SENTENCE, REST, SWEEP } from "./texts.ts";

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");

function Cards() {
  return (
    <>
      {[`${LONG_FIRST_SENTENCE} ${REST}`, LIST_FIRST].map((text) => (
        <DecisionCard key={text} coordinatorId={COORDINATOR} decision={{ kind: "recorded", text, at: 6_400 }} status="in-progress" onRevealed={null} />
      ))}
      {[HTML_EXAMPLE, ADJACENT_TAGS].map((text, n) => (
        <CommentCard key={text} coordinatorId={COORDINATOR} entry={{ kind: "comment", comment: { id: commentIdSchema.parse(`m${n + 1}`), issueId: issueIdSchema.parse("WEB-1"), at: 6_500, text, replyTo: null, author: { kind: "user" } } }} answered={null} agents={[]} />
      ))}
      <section aria-label="Sweep">
        {SWEEP.map((sentence) => (
          <DecisionCard key={sentence} coordinatorId={COORDINATOR} decision={{ kind: "recorded", text: `${sentence} ${REST}`, at: 6_600 }} status="in-progress" onRevealed={null} />
        ))}
      </section>
    </>
  );
}

draw(Cards, {}, { experimental_rpcContract: coordinatorContract, rpc: { coordinators: () => ({ coordinators: [], notStarted: [] }) } });
