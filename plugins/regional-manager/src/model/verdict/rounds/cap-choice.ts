// What the user chose at an issue's cap of failed verifications, and what each choice leaves the
// regional manager to do. The plugin offers three: merge the work as it is and file its open
// must-fix findings as a follow-up, give it one more round, or cancel the issue. An answer in the
// user's own words makes none of them: it allows one more round, as every answer did before the
// choices, and the regional manager reads its words. Only the plugin's own words are here, so a
// doorbell may hold them.
import type { Decision } from "../../decision.ts";
import type { IssueId } from "../../issue/issue.ts";
import { findingText, type Triaged } from "../review.ts";

const CHOICES = ["merge", "round", "cancel"] as const;
type CapChoice = (typeof CHOICES)[number];

/** Each choice's option, a button on the board; each says what it does. */
const OPTION: Record<CapChoice, string> = { merge: "Merge as is, file follow-ups", round: "One more round", cancel: "Cancel the issue" };

/** The options a cap question offers, in the order the board shows them. */
export const CAP_OPTIONS = CHOICES.map((choice) => OPTION[choice]);

/** The option the questions asked before the choices offered to cancel. why kept: those questions keep their stored options, and their answers still read so. */
const EARLIER_CANCEL = "Cancel it";

/**
 * The choice the answer to a cap question makes: the option it names, when the question offered
 * that option; null while it is unanswered, or for an answer in the user's own words, which is any
 * answer naming no option the question offered.
 */
export function capChoice({ options, answer }: Pick<Decision, "options" | "answer">): CapChoice | null {
  if (answer === null || !options.includes(answer.text)) return null;
  if (answer.text === EARLIER_CANCEL) return "cancel";
  return CHOICES.find((choice) => OPTION[choice] === answer.text) ?? null;
}

/**
 * Where the issue stood when the user answered: its pull request's number as last read (null: none
 * read), its branch as its agents' handoffs recorded it (null: none recorded), and the must-fix
 * findings its last failed verdict before the answer upheld.
 */
export type AnsweredAt = { pr: number | null; branch: string | null; mustFix: readonly Triaged[] };

/** The choice in a phrase, as a doorbell gives it after the question's id: "merge it as is, with no further round, and file its open must-fix findings as a follow-up". */
export function choicePhrase(choice: CapChoice): string {
  switch (choice) {
    case "merge":
      return "merge it as is, with no further round, and file its open must-fix findings as a follow-up";
    case "round":
      return "one more round";
    case "cancel":
      return "stop its agent, close its pull request and cancel it";
    default:
      return choice satisfies never;
  }
}

/** What the answer `choice` (null: one in the user's own words) leaves the regional manager to do about `issueId`, as catch-up gives it under the answer. */
export function choiceText(issueId: IssueId, choice: CapChoice | null, at: AnsweredAt): string {
  switch (choice) {
    case "merge":
      return `They chose to merge ${issueId} as it is, so it gets no further round. ${mergeMoves(issueId, at.pr)} ${followUpText(at.mustFix)}`;
    case "round":
      return `They chose one more round for ${issueId}: tell its agent what to fix with agent_message, or hand ${issueId} to a fresh agent with agent_start. If that round fails verification too, the plugin asks them again.`;
    case "cancel":
      return `They chose to cancel ${issueId}: stop its agent with agent_stop, if one holds it; ${closeText(at)}; and cancel ${issueId} with issue_update (status "canceled").`;
    case null:
      return `Their answer allows one more round for ${issueId}, as any answer in their own words does: read it for what they want.`;
    default:
      return choice satisfies never;
  }
}

/**
 * What a failure made while the user's answer to merge `issueId` as it is (`questionId`) stands
 * leaves to do: nothing new. why no follow-up: that answer's update ordered the one follow-up, with
 * the findings open when the user answered.
 */
export const mergeStandsText = (issueId: IssueId, questionId: string, pr: number | null): string =>
  `Nothing went back to an agent: the user chose to merge ${issueId} as it is (${questionId}), which allows no further round, so this failure files no follow-up of its own. ${mergeMoves(issueId, pr)}`;

/** How the pull request gets merged while the merge answer stands, and that the merge makes the issue Done. */
function mergeMoves(issueId: IssueId, pr: number | null): string {
  const it = pr === null ? "its pull request, if it has one," : `its pull request #${pr}`;
  return `Have ${it} merged without another review or verifier: ask its agent to merge it with agent_message, or, when no agent holds ${issueId}, start one with agent_start, with no from or placement, so it continues in its last agent's environment on that pull request's branch. agent_start on a new branch is refused while this answer stands, as that pull request would be left behind. Never merge it yourself; its merge makes ${issueId} Done.`;
}

/** The one follow-up the merge answer files: the open must-fix findings, listed; none to file when there are none. */
function followUpText(mustFix: readonly Triaged[]): string {
  if (mustFix.length === 0) return "Its last failed verdict upheld no must-fix finding, so there is no follow-up to file.";
  return `File the open must-fix findings of its last failed verdict as one follow-up issue with issue_create, listing each:\n\n${mustFix.map((finding) => `- ${findingText(finding)}`).join("\n")}`;
}

/** How to close the issue's pull request: by its number, else by its branch, which gh resolves to its pull request. */
function closeText({ pr, branch }: Pick<AnsweredAt, "pr" | "branch">): string {
  if (pr !== null) return `close its pull request #${pr} with \`gh pr close ${pr}\``;
  if (branch !== null) return `close its pull request, if one is open on its branch, with \`gh pr close ${branch}\``;
  return "close its pull request, if it has one, with `gh pr close` and its number";
}
