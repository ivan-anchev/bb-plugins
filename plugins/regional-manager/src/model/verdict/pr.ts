// The pull request of an agent's branch and its CI, as the plugin last read them from GitHub, and the one rule for
// what CI says about the commit a done handoff claims. Pure: the watch writes the reading, and
// settling a verdict, the board and the texts read it.
import { z } from "zod";
import { commitSchema, type HandoffId } from "../agent/handoff.ts";

/** A pull request's checks on its head commit, rolled up as GitHub's merge box rolls them. `none`: it reports no checks. */
const ciSchema = z.enum(["none", "pending", "pass", "fail"]);

/** A branch's pull request as one successful read of GitHub found it. `failedChecks`: the name of each failed check, while CI fails. */
export const prSnapshotSchema = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  state: z.enum(["open", "merged", "closed"]),
  draft: z.boolean(),
  review: z.enum(["approved", "changes-requested", "none"]),
  ci: ciSchema,
  headSha: commitSchema,
  failedChecks: z.array(z.string()),
});
export type PrSnapshot = z.infer<typeof prSnapshotSchema>;

/**
 * The latest read that found a branch's pull request, and what it vouches for: when a read first saw
 * the snapshot's head commit, when this one was read, and its agent's latest handoff as the read
 * began (null: it had made none). why as it began: a handoff made while gh ran came after what gh
 * answered. Only a read that returns a pull request writes it: a failed read, one that found none,
 * and time passing leave it as it was.
 */
type PrFound = { snapshot: PrSnapshot; headSeenAt: number; readAt: number; handoffAtRead: HandoffId | null };

/**
 * Why a read of a branch's pull request failed, in the words the board shows, and whether it lasts.
 * `persistent`: no read can succeed until someone acts, as when gh is missing, GitHub rejects its
 * credentials or the repository isn't on GitHub. `transient`: the next read may, as after a
 * timeout, a dropped connection, a rate limit or a failure nothing explains.
 */
export const prUnavailableSchema = z.object({ kind: z.enum(["persistent", "transient"]), reason: z.string() });
export type PrUnavailable = z.infer<typeof prUnavailableSchema>;

/** One read of a branch's pull request: what it found (null: none), or why GitHub couldn't be read. */
export type PrRead = { kind: "read"; pr: PrSnapshot | null } | { kind: "unread"; reason: string };

/** What the plugin knows of a branch's pull request: the latest read that found it (snapshot null: none has), and why the latest read failed (null: it didn't). */
export type PrStatus = ({ snapshot: null } | PrFound) & { unavailable: PrUnavailable | null };

/** A change in a branch's pull request worth waking its coordinating thread for. */
export const prChangeSchema = z.enum(["opened", "reopened", "merged", "closed", "ci-passed", "ci-failed", "approved", "changes-requested"]);
export type PrChange = z.infer<typeof prChangeSchema>;

/** Each change in words, as the doorbell and the catch-up say it. */
export const PR_CHANGE_WORDS: Record<PrChange, string> = {
  opened: "opened",
  reopened: "reopened",
  merged: "merged",
  closed: "closed",
  "ci-passed": "CI passed",
  "ci-failed": "CI failed",
  approved: "approved",
  "changes-requested": "changes requested",
};

/**
 * What changed between two snapshots of a branch's pull request that its coordinating thread should
 * hear of, in that order: it opened, reopened, merged or closed; its CI turned green or red; a
 * review approved it or asked for changes. Empty: nothing did. why not a new pending run: the
 * thread can't act on it, and the run's end is the change.
 */
export function meaningfulChanges(before: PrSnapshot | null, after: PrSnapshot): PrChange[] {
  if (before === null) return [after.state === "open" ? "opened" : after.state];
  const changes: PrChange[] = [];
  if (before.state !== after.state) changes.push(after.state === "open" ? "reopened" : after.state);
  if (before.ci !== after.ci && (after.ci === "pass" || after.ci === "fail")) changes.push(after.ci === "pass" ? "ci-passed" : "ci-failed");
  if (before.review !== after.review && after.review !== "none") changes.push(after.review);
  return changes;
}

/** Whether a pull request's CI is still running, so the watch reads it again on the next tick. */
export const ciRunning = (pr: PrSnapshot): boolean => pr.state === "open" && pr.ci === "pending";

/** What CI says about a commit: a verdict that passed all but CI is judged with it. */
export const ciVerdictSchema = z.discriminatedUnion("kind", [
  /** There is no pull request to check. */
  z.object({ kind: z.literal("none") }),
  /** The pull request reported no checks at this commit, still none once GitHub had time to attach them. */
  z.object({ kind: z.literal("no-checks"), number: z.number().int() }),
  /** CI on the pull request passed at this commit. */
  z.object({ kind: z.literal("pass"), number: z.number().int() }),
  /** CI on the pull request failed at this commit; each failed check by name. */
  z.object({ kind: z.literal("fail"), number: z.number().int(), failedChecks: z.array(z.string()) }),
  /** The plugin couldn't read CI for this commit, and why. */
  z.object({ kind: z.literal("not-checked"), reason: z.string() }),
]);
export type CiVerdict = z.infer<typeof ciVerdictSchema>;

/** CI on a commit, or that it is still to come: `number` is its pull request's (null: not seen yet). */
export type Ci = CiVerdict | { kind: "waiting"; number: number | null };

// why five minutes: over 93 pushes to ivan-anchev/bb-plugins, GitHub attached checks at most 97 s (median 5 s) after a commit reached a pull request.
const CHECKS_GRACE_MS = 5 * 60_000;

/** The done handoff whose commit CI is judged on: its id, the commit it claims, and the pull request it names (null: none). */
type Claim = { id: HandoffId; headSha: string; prUrl: string | null };

/**
 * What CI says about the commit a done handoff claims, given its branch's PR status (null: never
 * read). With no pull request named or known there is nothing to check. A snapshot of this commit
 * whose CI finished says it; anything else waits, unless the latest read failed in a way no later
 * read can fix, or a read begun since the handoff found the pull request merged or closed at
 * another commit, when it can't be checked. why not a snapshot of another commit: its CI says
 * nothing about this one. why a read begun since the handoff: one before it may be of a pull
 * request reopened since. why wait through a transient failure: it says nothing about CI, and the
 * next read may.
 */
export function ciOf({ id, headSha, prUrl }: Claim, status: PrStatus | null): Ci {
  const found = status !== null && status.snapshot !== null ? status : null;
  if (found === null && prUrl === null) return { kind: "none" };
  const finished = found !== null && found.snapshot.headSha === headSha ? finishedOnHead(found) : null;
  if (finished !== null) return finished;
  if (status?.unavailable?.kind === "persistent") return { kind: "not-checked", reason: `PR status unavailable: ${status.unavailable.reason}` };
  if (found !== null && found.snapshot.state !== "open" && found.handoffAtRead === id) return { kind: "not-checked", reason: `#${found.snapshot.number} was ${found.snapshot.state} before CI finished on this commit` };
  return { kind: "waiting", number: found?.snapshot.number ?? null };
}

/**
 * What CI finished as on the found snapshot's head commit; null while it may still be to come. why
 * zero checks wait until a read past the window still sees none: right after a push GitHub may not
 * have attached them yet, an unknown check state is not a pass, and time passing since a read
 * says nothing about what GitHub has now.
 */
function finishedOnHead({ snapshot: pr, headSeenAt, readAt }: PrFound): CiVerdict | null {
  switch (pr.ci) {
    case "pass":
      return { kind: "pass", number: pr.number };
    case "fail":
      return { kind: "fail", number: pr.number, failedChecks: pr.failedChecks };
    case "pending":
      return null;
    case "none":
      return readAt - headSeenAt >= CHECKS_GRACE_MS ? { kind: "no-checks", number: pr.number } : null;
    default:
      return pr.ci satisfies never;
  }
}
