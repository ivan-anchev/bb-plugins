// What the user chose at an issue's cap of failed verifications, and what each choice leaves the
// regional manager to do. The plugin offers three: merge the work as it is and file its open
// must-fix findings as a follow-up, give it one more round, or cancel the issue. An answer in the
// user's own words makes none of them: it allows one more round, as every answer did before the
// choices, and the regional manager reads its words. Only the plugin's own words are here, so a
// doorbell may hold them.
import type { Decision } from "../../decision.ts";
import type { IssueId } from "../../issue/issue.ts";
import { FORGE, prRef, type PrNumber } from "../pr.ts";
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
 * Where the issue stood when the user answered: its branch as its agents' handoffs recorded it
 * (null: none recorded), and what the merge answer leaves to do about its pull request (`merge`).
 */
export type AnsweredAt = { branch: string | null; merge: MergeGuidance };

/**
 * What the merge answer leaves to do, by its pull request: `merged` since, by its number, leaving
 * only the follow-up; else `unmerged` (`pr` as last read, null: none read), to be merged, with the
 * follow-up, or the accept that files it.
 */
type MergeGuidance = { kind: "merged"; pr: PrNumber; followUp: FollowUp } | { kind: "unmerged"; pr: PrNumber | null; followUp: FollowUp | { kind: "accept" } };

/**
 * The one follow-up the merge answer files, of the issue's last failed verdict before the answer:
 * `filed` already as `id`, as the manager's accept of that verdict filed it (issues.ts acceptEdit);
 * else `by-hand`, its must-fix findings, for the manager to file. `accept`, in MergeGuidance: the
 * manager may still accept that verdict as it is (verdict.ts acceptableAsIs), which files it.
 */
export type FollowUp = { kind: "filed"; id: IssueId } | { kind: "by-hand"; mustFix: readonly Triaged[] };

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
      return `They chose to merge ${issueId} as it is, so it gets no further round. ${mergeStepsText(issueId, at.merge)}`;
    case "round":
      return `They chose one more round for ${issueId}: tell its agent what to fix with agent_message, or hand ${issueId} to a fresh agent with agent_start. If that round fails verification too, the plugin asks them again.`;
    case "cancel":
      return `They chose to cancel ${issueId}: stop its agent with agent_stop, if one holds it; ${closeText(at.merge.pr, at.branch)}; and cancel ${issueId} with issue_update (status "canceled").`;
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
export const mergeStandsText = (issueId: IssueId, questionId: string, pr: PrNumber | null): string =>
  `Nothing went back to an agent: the user chose to merge ${issueId} as it is (${questionId}), which allows no further round, so this failure files no follow-up of its own. ${mergeMoves(issueId, pr)}`;

/**
 * What the merge answer leaves to do: once its pull request merged, only the follow-up, as the
 * merge made the issue Done; while the accept goes through, the accept first, which files the
 * follow-up, then the merge; else the merge and the follow-up, already filed or filed by hand.
 */
function mergeStepsText(issueId: IssueId, merge: MergeGuidance): string {
  switch (merge.kind) {
    case "merged":
      return `Its ${prText(merge.pr)} has merged since, which made ${issueId} Done, so nothing is left to merge. ${followUpText(issueId, merge.followUp)}`;
    case "unmerged":
      return merge.followUp.kind === "accept" ? `${acceptFirst(issueId)} ${mergeMoves(issueId, merge.pr)}` : `${mergeMoves(issueId, merge.pr)} ${followUpText(issueId, merge.followUp)}`;
    default:
      return merge satisfies never;
  }
}

/** How the pull request gets merged while the merge answer stands, and that the merge makes the issue Done. */
function mergeMoves(issueId: IssueId, pr: PrNumber | null): string {
  const it = pr === null ? "its pull request, if it has one," : `its ${prText(pr)}`;
  return `Have ${it} merged without another review or verifier: ask its agent to merge it with agent_message, or, when no agent holds ${issueId}, start one with agent_start, with no from or placement, so it continues in its last agent's environment on that pull request's branch. agent_start on a new branch is refused while this answer stands, as that pull request would be left behind. Never merge it yourself; its merge makes ${issueId} Done.`;
}

/**
 * The merge answer after a failure on review findings alone, through the manager's accept
 * (issues.ts acceptEdit): it files the findings the issue leaves as the one follow-up, and keeps
 * the issue In review until its merge.
 */
const acceptFirst = (issueId: IssueId): string =>
  `Its last failure was on review findings alone, so first accept it as it is: issue_update { id: "${issueId}", status: "in-review", decision: "<their answer, and why>" } puts it In review until its pull request merges, and files the findings it leaves, its open must-fix findings among them, as one follow-up. File no other follow-up.`;

/** The one follow-up the merge answer files: named, when the manager's accept filed it; else the open must-fix findings, listed, to file; none to file when there are none. */
function followUpText(issueId: IssueId, followUp: FollowUp): string {
  switch (followUp.kind) {
    case "filed":
      return `Your accept of ${issueId}'s last failure filed its open must-fix findings as ${followUp.id}, the one follow-up this answer files, so file no other.`;
    case "by-hand":
      if (followUp.mustFix.length === 0) return "Its last failed verdict upheld no must-fix finding, so there is no follow-up to file.";
      return `File the open must-fix findings of its last failed verdict as one follow-up issue with issue_create, listing each:\n\n${followUp.mustFix.map((finding) => `- ${findingText(finding, "  ")}`).join("\n")}`;
    default:
      return followUp satisfies never;
  }
}

/**
 * How to close the issue's pull request or merge request: by its number, with its forge's command;
 * else by its branch, which each forge's CLI resolves to its change request, naming both forges'
 * commands, as no read says which forge it is on.
 */
function closeText(pr: PrNumber | null, branch: string | null): string {
  if (pr !== null) return `close its ${prText(pr)} with \`${FORGE[pr.forge].close} ${pr.number}\``;
  const { github, gitlab } = FORGE;
  if (branch !== null) return `close its pull request or merge request, if one is open on its branch, with \`${github.close} ${branch}\` on GitHub or \`${gitlab.close} ${branch}\` on GitLab`;
  return `close its pull request or merge request, if it has one, with \`${github.close}\` on GitHub or \`${gitlab.close}\` on GitLab, and its number`;
}

/** A known change request in words: "pull request #41", "merge request !41". */
const prText = (pr: PrNumber): string => `${FORGE[pr.forge].noun} ${prRef(pr)}`;
