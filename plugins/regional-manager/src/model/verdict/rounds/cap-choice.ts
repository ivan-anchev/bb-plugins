// What the user chose at an issue's cap of failed verifications, and what each choice leaves the
// regional manager to do. The plugin offers three: merge the work as it is and file what failed it
// as a follow-up, give it one more round, or cancel the issue. An answer in the user's own words
// makes none of them: it allows one more round, as every answer did before the choices, and the
// regional manager reads its words. Only the plugin's own words are here, so a doorbell may hold them.
import type { IssueId } from "../../issue/issue.ts";
import { findingText, type Triaged } from "../review.ts";

const CHOICES = ["merge", "round", "cancel"] as const;
export type CapChoice = (typeof CHOICES)[number];

/** Each choice's option, a button on the board; each says what it does. */
const OPTION: Record<CapChoice, string> = { merge: "Merge as is, file follow-ups", round: "One more round", cancel: "Cancel the issue" };

/** The options a cap question offers, in the order the board shows them. */
export const CAP_OPTIONS = CHOICES.map((choice) => OPTION[choice]);

/** The option the questions asked before the choices offered to cancel. why kept: those questions keep their stored options, and their answers still read so. */
const EARLIER_CANCEL = "Cancel it";

/** The choice an answer to a cap question makes, by its option's words; null for an answer in the user's own words. */
export function capChoice(answer: string): CapChoice | null {
  if (answer === EARLIER_CANCEL) return "cancel";
  return CHOICES.find((choice) => OPTION[choice] === answer) ?? null;
}

/** What the issue stood at when the user answered: its pull request's number (null: none the plugin read), and the must-fix findings its last failed verdict upheld. */
export type AnsweredAt = { pr: number | null; mustFix: readonly Triaged[] };

/** The choice in a phrase, as a doorbell gives it after the question's id: "merge it as is, with no further round, and file its open must-fix findings as a follow-up". */
export function choicePhrase(choice: CapChoice): string {
  switch (choice) {
    case "merge":
      return "merge it as is, with no further round, and file its open must-fix findings as a follow-up";
    case "round":
      return "one more round";
    case "cancel":
      return "cancel it and close its pull request";
    default:
      return choice satisfies never;
  }
}

/** What the answer `choice` (null: one in the user's own words) leaves the regional manager to do about `issueId`, as catch-up gives it under the answer. */
export function choiceText(issueId: IssueId, choice: CapChoice | null, at: AnsweredAt): string {
  switch (choice) {
    case "merge":
      return `They chose to merge ${issueId} as it is: ${mergeText(issueId, at)}`;
    case "round":
      return `They chose one more round for ${issueId}: tell its agent what to fix with agent_message, or hand ${issueId} to a fresh agent with agent_start. If that round fails verification too, the plugin asks them again.`;
    case "cancel":
      return `They chose to cancel ${issueId}: stop its agent with agent_stop, if one holds it; close ${prText(at.pr)} with \`gh pr close${at.pr === null ? "" : ` ${at.pr}`}\`; and cancel ${issueId} with issue_update (status "canceled").`;
    case null:
      return `Their answer allows one more round for ${issueId}, as any answer in their own words does: read it for what they want.`;
    default:
      return choice satisfies never;
  }
}

/**
 * What merging `issueId` as it is leaves to do, while that answer stands: have its pull request
 * merged by an agent, with no further round, and file the open must-fix findings as one follow-up.
 * The one wording both the answer and a failure made after it give.
 */
export function mergeText(issueId: IssueId, { pr, mustFix }: AnsweredAt): string {
  const merge = `${issueId} gets no further round. Have ${prText(pr)} merged without another review or verifier: ask its agent to merge it with agent_message, or, when no agent holds ${issueId}, start one with agent_start to do only that. Never merge it yourself; the merge makes ${issueId} Done. A done handoff on ${issueId} from now on still gets its verdict, but a failure goes back to no agent and asks the user nothing.`;
  if (mustFix.length === 0) return `${merge} Its last failed verdict upheld no must-fix finding, so file what failed it instead, as issue_read gives it, as one follow-up issue with issue_create.`;
  return `${merge} File the open must-fix findings of its last failed verdict as one follow-up issue with issue_create, listing each:\n\n${mustFix.map((finding) => `- ${findingText(finding)}`).join("\n")}`;
}

const prText = (pr: number | null): string => (pr === null ? "its pull request, if it has one," : `its pull request #${pr}`);
