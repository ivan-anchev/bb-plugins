// An agent's own tool: agent_handoff, the one structured report it ends with. It is stored whole, so
// the regional manager reads every word through crew_catch_up, and none of it reaches the doorbell.
// The caller's role comes from the plugin's database by its thread id, never from its metadata; the
// agent's id is its generation token, so an agent that no longer holds its issue can't write to it.
import { randomUUID } from "node:crypto";
import type { Agent, AgentCheckout, EndedHow } from "../../model/agent/agent.ts";
import { handoffFieldsSchema, handoffIdSchema, reportOf, type GivenReport } from "../../model/agent/handoff.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import { PIPELINES, shipsCode } from "../../model/issue/kind.ts";
import type { CheckoutRead } from "../../model/verdict/checkout.ts";
import { latestTurnSeq, listedThreads, type TurnsBb } from "../agents/threads.ts";
import { threadExecution, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import { checkoutReadOf, gitStatusOf, type GitStatus, type GitStatusBb } from "../git-status.ts";
import type { Store } from "../store/store.ts";
import type { Verify } from "../verify/verify.ts";
import type { PrWatch } from "../watch/pr-watch.ts";
import { agentOf, failed, refusedBusy, type ToolsBb } from "./tool-kit.ts";

export const HANDOFF = "agent_handoff";

type ListedThread = { id: string; providerId: string; environmentId: string | null; environmentBranchName: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb the handoff uses: registering it, the thread's turns, what it runs on, its environment and bb's git plugin's read of it. */
type HandoffBb = ToolsBb & TurnsBb & GitStatusBb & ThreadExecutionBb & { sdk: { threads: { list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]> } } };

type Deps = { store: Pick<Store, "roleOfThread" | "agent" | "issue">; verify: Pick<Verify, "handoff">; prs: Pick<PrWatch, "headBranchOf"> };

export function registerHandoffTool(bb: HandoffBb, { store, verify, prs }: Deps): void {
  /** The agent's environment, the branch bb made it on, and bb's git plugin's read of it, once, now, while the agent is awake to hand off; null when its thread has none. */
  async function readEnvironment(threadId: string): Promise<EnvironmentRead | null> {
    const thread = (await listedThreads(bb, [threadId])).get(threadId);
    if (thread === undefined || thread.environmentId === null) return null;
    return { environmentId: thread.environmentId, environmentBranchName: thread.environmentBranchName, status: await gitStatusOf(bb, thread.environmentId) };
  }

  /**
   * The branch a done report's pull request is from, read from GitHub only when the read checkout
   * names no branch, as on a detached HEAD (null: not read, or GitHub couldn't say). why: the pull
   * request it delivers is then the one thing that names where its work was published.
   */
  async function publishedBranch(agent: Agent, environment: EnvironmentRead | null, report: GivenReport): Promise<string | null> {
    if (environment?.status.kind !== "read" || environment.status.branch !== null) return null;
    if (report.status !== "done" || report.delivery.kind !== "commit" || report.delivery.prUrl === null) return null;
    return prs.headBranchOf(agent.coordinatorId, report.delivery.prUrl);
  }

  bb.agents.registerTool({
    name: HANDOFF,
    description:
      "Your report to your regional manager: call it once, as the last thing you do in a turn that ends your work, then stop. Everything in it reaches your regional manager whole. Use status done on a build issue only when every done-criterion is met and committed, and on a research issue once your report is written.",
    instructions: HANDOFF_INSTRUCTIONS,
    presentation: { label: { pending: "Handing off", completed: "Handed off" }, icon: { glyph: "Check" } },
    parameters: handoffFieldsSchema,
    execute: async (input, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "agent") return failed(`${HANDOFF} is refused: only an agent thread of a regional manager hands off, and this thread is not one. Carry on without it.`);
      const caller = agentOf(store, role);
      const issue = store.issue(caller.coordinatorId, caller.issueId);
      // why throw: an agent is inserted on an issue of its regional manager, and issues are never deleted.
      if (issue === null) throw new Error(`The issue ${caller.issueId} of ${caller.coordinatorId} is missing.`);
      if (caller.ended !== null) return endedText(issue.id, caller.ended.how);
      // why only for a kind that ships code: the plugin reads no checkout, through bb's git plugin, of an agent whose commit is not its result.
      const reading = shipsCode(issue.kind) ? readEnvironment(threadId) : null;
      // why at each handoff: the model that made the work is a stored fact, never read from an ended thread.
      const [turnSeq, environment, execution] = await Promise.all([latestTurnSeq(bb, threadId), reading, threadExecution(bb, threadId)]);
      // why throw: this call runs inside a turn, so bb has its turn/started event.
      if (turnSeq === null) throw new Error("bb lists no turn for this thread, so the handoff can't be tied to one. Try again.");
      const report = reportOf(input, issue.kind);
      if ("refused" in report) return failed(`${HANDOFF} is refused and nothing was saved: ${report.refused}`);
      const checkout = reading === null ? NOT_READ : checkoutRead(environment);
      const published = await publishedBranch(caller, environment, report);
      const handoff = { id: handoffIdSchema.parse(randomUUID()), coordinatorId: caller.coordinatorId, issueId: issue.id, agentId: caller.id, at: Date.now(), turnSeq, ...report };
      const outcome = await verify.handoff({ handoff, checkout, seen: environment === null ? null : checkoutSeen(caller, environment, published), environmentBranchName: environment?.environmentBranchName ?? null, execution });
      if ("busy" in outcome) return refusedBusy(HANDOFF, outcome);
      if ("ended" in outcome) return endedText(issue.id, outcome.ended);
      const verdict = outcome.check?.verdict ?? null;
      if (verdict === null && report.status === "done") return `Handed off. Your regional manager has your report, and ${issue.id} is Done: nothing verifies a ${PIPELINES[issue.kind].label.toLowerCase()} issue. Stop here.`;
      if (verdict === null) return "Handed off. Your regional manager has your report. Stop here.";
      if (verdict.state === "waived") return "Handed off. Your regional manager has your report, marked unverified: verification is off. Stop here.";
      if (verdict.state === "could-not-run") return `Handed off. Your regional manager has your report, marked couldn't verify: ${verdict.reason}. Stop here.`;
      return "Handed off. Once this turn of yours ends, a verifier checks your commit against the done-criteria in this environment, and your regional manager gets your report with its verdict. If it fails, its findings may come back to you here, as a message from the verifier. Stop here, and change nothing in this environment until you hear back from the verifier or your regional manager.";
    },
  });
}

/** The checkout of an agent whose issue ships no code: never read, and never checked. */
const NOT_READ: CheckoutRead = { kind: "unread", reason: "its issue ships no code, so the plugin read no checkout" };

/** An agent's environment, the branch bb made it on (null: none recorded), and bb's git plugin's read of it. */
type EnvironmentRead = { environmentId: string; environmentBranchName: string | null; status: GitStatus };

/**
 * Where the agent's work is, as read: its branch the one checked out, else the one its delivered
 * pull request is from (`published`), else as recorded; any other field the read can't name keeps
 * what was recorded.
 */
function checkoutSeen(agent: Agent, { environmentId, status }: EnvironmentRead, published: string | null): AgentCheckout {
  return status.kind === "read" ? { environmentId, branch: status.branch ?? published ?? agent.checkout.branch, head: status.headSha ?? agent.checkout.head } : { ...agent.checkout, environmentId };
}

/** The agent's checkout for the verdict, as read (null: its thread has no environment). */
const checkoutRead = (environment: EnvironmentRead | null): CheckoutRead =>
  environment === null ? { kind: "unread", reason: "the agent's thread has no environment" } : checkoutReadOf(environment.status);

const endedText = (issueId: IssueId, how: EndedHow) => failed(`${HANDOFF} is refused: you no longer hold ${issueId} (you were ${how}), so nothing reads a handoff from you. Stop here.`);

const HANDOFF_INSTRUCTIONS = `Ending your work: call agent_handoff once, as your last action, then stop. Your regional manager reads only this report, not your chat.
- status: "done" (a build issue: every done-criterion met and committed; a research issue: your report written), "blocked" (you need a decision, or hit a problem you didn't cause), or "gave-up" (a retried approach failed again).
- summary: one line, up to 120 characters, not opening with the status (it is shown after it, as in "Blocked: <summary>").
- did, evidence, concerns, deviations, findings: up to 50 items each, each up to 2,000 characters. evidence: on a build issue, for each done-criterion, the command you ran and what it printed. Use [] for none.
- A build issue's done handoff: headSha (required), the output of \`git rev-parse HEAD\` after your last commit; prUrl, the pull request, if you opened one.
- A research issue's done handoff: report (required), your whole report in markdown, up to 20,000 characters. It names no commit: nothing you commit or push is read.
A turn that ends without agent_handoff tells your regional manager you stopped without reporting.`;
