// A crew's own tool: crew_handoff, the one structured report it ends with. It is stored whole, so
// the coordinating thread reads every word through crew_catch_up, and none of it reaches the
// doorbell. The caller's role comes from the plugin's database by its thread id, never from its
// metadata.
import { randomUUID } from "node:crypto";
import type { Crew } from "../../model/crew.ts";
import { handoffIdSchema, handoffInputSchema } from "../../model/handoff.ts";
import { checkoutOf, type CheckoutRead } from "../../model/verdict/checkout.ts";
import { listedThreads } from "../crew/board/board.ts";
import { latestTurnSeq, type TurnsBb } from "../crew/handoffs.ts";
import { gitStatusOf, type GitStatusBb } from "../git-status.ts";
import type { Store } from "../store.ts";
import type { Verify } from "../verify/verify.ts";
import { failed, type ToolsBb } from "./tool-kit.ts";

export const HANDOFF = "crew_handoff";

type ListedThread = { id: string; environmentId: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb the handoff uses: registering it, the thread's turns, its environment and bb's git plugin's read of it. */
type CrewToolsBb = ToolsBb & TurnsBb & GitStatusBb & { sdk: { threads: { list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]> } } };

type Deps = { store: Pick<Store, "roleOfThread" | "crew" | "recordBranch">; verify: Pick<Verify, "handoff"> };

export function registerCrewTools(bb: CrewToolsBb, { store, verify }: Deps): void {
  /**
   * Reads the crew's environment through bb's git plugin, once, now, while the crew is awake to hand
   * off: records the branch it has checked out, and returns its checkout for the verdict.
   */
  async function readCheckout(crew: Crew, threadId: string): Promise<CheckoutRead> {
    const environmentId = (await listedThreads(bb, [threadId])).get(threadId)?.environmentId ?? null;
    if (environmentId === null) return { kind: "unread", reason: "the crew's thread has no environment" };
    const status = await gitStatusOf(bb, environmentId);
    if (status.kind === "read" && status.branch !== null) store.recordBranch(crew.coordinatorId, crew.id, status.branch);
    switch (status.kind) {
      case "read":
        return status.headSha === null
          ? { kind: "unread", reason: "it named no commit checked out" }
          : { kind: "read", checkout: checkoutOf(status.headSha, status.changedFiles, status.changedFileCount) };
      case "not-git":
        return { kind: "unread", reason: "the environment is not a git repository" };
      case "unread":
        return status;
      default:
        return status satisfies never;
    }
  }

  bb.agents.registerTool({
    name: HANDOFF,
    description:
      "Your report to your regional manager: call it once, as the last thing you do in a turn that ends your work, then stop. Everything in it reaches your regional manager whole. Use status done only when every done-criterion is met and committed.",
    instructions: HANDOFF_INSTRUCTIONS,
    presentation: { label: { pending: "Handing off", completed: "Handed off" }, icon: { glyph: "Check" } },
    parameters: handoffInputSchema,
    execute: async (report, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "crew") return failed(`${HANDOFF} is refused: only a crew thread of a regional manager hands off, and this thread is not one. Carry on without it.`);
      const crew = store.crew(role.coordinatorId, role.crewId);
      // why throw: a role's crew is inserted with its ticket, in one transaction.
      if (crew === null) throw new Error(`The crew ${role.crewId} of ${role.coordinatorId} is missing.`);
      if (crew.closed !== null) return failed(`${HANDOFF} is refused: your regional manager closed you as ${crew.closed.kind}, so nothing reads a handoff. Stop here.`);
      const turnSeq = await latestTurnSeq(bb, threadId);
      // why throw: this call runs inside a turn, so bb has its turn/started event.
      if (turnSeq === null) throw new Error("bb lists no turn for this thread, so the handoff can't be tied to one. Try again.");
      const checkout = await readCheckout(crew, threadId);
      const verdict = await verify.handoff({ id: handoffIdSchema.parse(randomUUID()), coordinatorId: crew.coordinatorId, crewId: crew.id, at: Date.now(), turnSeq, ...report }, checkout);
      if (verdict === null) return "Handed off. Your regional manager has your report. Stop here.";
      if (verdict.state === "waived") return "Handed off. Your regional manager has your report, marked unverified: verification is off. Stop here.";
      if (verdict.state === "could-not-run") return `Handed off. Your regional manager has your report, marked couldn't verify: ${verdict.reason}. Stop here.`;
      return "Handed off. A verifier now checks your commit against the done-criteria in this environment, and your regional manager gets your report with its verdict. If it fails, its findings may come back to you here, as a message from the verifier. Stop here, and change nothing in this environment until you hear back.";
    },
  });
}

const HANDOFF_INSTRUCTIONS = `Ending your work: call crew_handoff once, as your last action, then stop. Your regional manager reads only this report, not your chat.
- status: "done" (every done-criterion met and committed), "blocked" (you need a decision, or hit a problem you didn't cause), or "gave-up" (a retried approach failed again).
- summary: one line, up to 120 characters, not opening with the status (it is shown after it, as in "Blocked: <summary>").
- did, evidence, concerns, deviations, findings: up to 50 items each, each up to 2,000 characters. evidence: for each done-criterion, the command you ran and what it printed. Use [] for none.
- headSha (done only, required): the output of \`git rev-parse HEAD\` after your last commit. prUrl: the pull request, if you opened one.
A turn that ends without crew_handoff tells your regional manager you stopped without reporting.`;
