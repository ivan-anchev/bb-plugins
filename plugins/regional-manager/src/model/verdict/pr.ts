// The pull request or merge request of an agent's branch and its CI, as the plugin last read them
// from its forge, the words each forge uses for them, and the one rule for what CI says about the
// commit a done handoff claims. Pure: the watch writes the reading, and settling a verdict, the
// board and the texts read it.
import { z } from "zod";
import { commitSchema, type HandoffId } from "../agent/handoff.ts";

/** The forges the PR watch reads. */
export const forgeSchema = z.enum(["github", "gitlab"]);
export type Forge = z.infer<typeof forgeSchema>;

/** How each forge names a change request and its parts, as people and agents read them: the one home of `#`, `!`, PR, MR and the command that closes one. */
export const FORGE = {
  github: { name: "GitHub", short: "PR", noun: "pull request", sigil: "#", close: "gh pr close" },
  gitlab: { name: "GitLab", short: "MR", noun: "merge request", sigil: "!", close: "glab mr close" },
} as const satisfies Record<Forge, { name: string; short: string; noun: string; sigil: string; close: string }>;

/**
 * A change request's number and the forge it is on. why a default: a row stored before GitLab was
 * read is GitHub's, and the store adds a field to stored JSON this way (inbox-event.ts `asked`,
 * verdict.ts `blocking`), so no migration rewrites old rows.
 */
const prNumberShape = { forge: forgeSchema.default("github"), number: z.number().int().positive() };
export const prNumberSchema = z.object(prNumberShape);
export type PrNumber = z.infer<typeof prNumberSchema>;

/** The number in its forge's notation: "#41" on GitHub, "!41" on GitLab. */
export const prRef = (pr: PrNumber): string => `${FORGE[pr.forge].sigil}${pr.number}`;

/** The number with its forge's short word: "PR #41", "MR !41". */
export const prName = (pr: PrNumber): string => `${FORGE[pr.forge].short} ${prRef(pr)}`;

/**
 * A change request's checks on its head commit, rolled up as its forge's merge box rolls them.
 * `none`: it reports no checks. `blocked`: GitLab's pipeline stopped at a manual job that doesn't
 * allow failure, which runs only once a person plays it.
 */
const ciSchema = z.enum(["none", "pending", "pass", "fail", "blocked"]);

/**
 * A branch's change request as one successful read of its forge found it. `review`: the blocking
 * feedback first, `unresolved-discussions` only on GitLab, which reports review feedback as
 * discussion threads. `failedChecks`: each failed check or job by name, while CI fails, as the forge
 * gave them.
 */
export const prSnapshotSchema = z.object({
  ...prNumberShape,
  url: z.url(),
  state: z.enum(["open", "merged", "closed"]),
  draft: z.boolean(),
  review: z.enum(["approved", "changes-requested", "unresolved-discussions", "none"]),
  ci: ciSchema,
  headSha: commitSchema,
  failedChecks: z.array(z.string()),
});
export type PrSnapshot = z.infer<typeof prSnapshotSchema>;

/** What a change request's badge shows of a snapshot (app pr-badge.tsx): its forge and number, link, state and CI. */
export const prBadgeSchema = prSnapshotSchema.pick({ forge: true, number: true, url: true, state: true, draft: true, ci: true, failedChecks: true });
export type PrBadgeFacts = z.infer<typeof prBadgeSchema>;

/**
 * The latest read that found a branch's pull request, and what it vouches for: when a read first saw
 * the snapshot's head commit, when this one was read, and its agent's latest handoff as the read
 * began (null: it had made none). why as it began: a handoff made while gh ran came after what gh
 * answered. Only a read that returns a pull request writes it: a failed read, one that found none,
 * and time passing leave it as it was.
 */
type PrFound = { snapshot: PrSnapshot; headSeenAt: number; readAt: number; handoffAtRead: HandoffId | null };

/**
 * Why a read of a branch's change request failed, in the words the board shows, and whether it
 * lasts. `persistent`: no read can succeed until someone acts, as when the CLI is missing, the
 * forge rejects its credentials or the project is on no forge the plugin reads. `transient`: the
 * next read may, as after a timeout, a dropped connection, a rate limit or a failure nothing
 * explains. `forge`: the forge the read was of; null when the project's remote is on none the
 * plugin reads. why default null: a reason stored before forges were told apart reads with the
 * label it had, and the next poll rewrites it.
 */
export const prUnavailableSchema = z.object({ kind: z.enum(["persistent", "transient"]), reason: z.string(), forge: forgeSchema.nullable().default(null) });
export type PrUnavailable = z.infer<typeof prUnavailableSchema>;

/** The label a failed read is shown under: "MR status unavailable" on GitLab, "PR status unavailable" otherwise. */
export const statusLabel = (forge: Forge | null): string => `${FORGE[forge ?? "github"].short} status unavailable`;

/** One read of every watched branch of a project: each branch's change request (null: none), or why its forge couldn't be read. Both forges' readers return it. */
export type BranchesRead = { kind: "read"; prs: Map<string, PrSnapshot | null> } | { kind: "unavailable"; unavailable: PrUnavailable };

/** One read of a branch's pull request: what it found (null: none), or why its forge couldn't be read. */
export type PrRead = { kind: "read"; pr: PrSnapshot | null } | { kind: "unread"; reason: string };

/** What the plugin knows of a branch's pull request: the latest read that found it (snapshot null: none has), and why the latest read failed (null: it didn't). */
export type PrStatus = ({ snapshot: null } | PrFound) & { unavailable: PrUnavailable | null };

/** A change in a branch's pull request worth waking its coordinating thread for. */
export const prChangeSchema = z.enum(["opened", "reopened", "merged", "closed", "ci-passed", "ci-failed", "approved", "changes-requested", "unresolved-discussions"]);
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
  "unresolved-discussions": "unresolved discussions",
};

/**
 * What changed between two snapshots of a branch's pull request that its coordinating thread should
 * hear of, in that order: it opened, reopened, merged or closed; its CI turned green or red; a
 * review approved it, asked for changes or left discussions unresolved. Empty: nothing did. why not
 * a new pending run: the thread can't act on it, and the run's end is the change.
 */
export function meaningfulChanges(before: PrSnapshot | null, after: PrSnapshot): PrChange[] {
  if (before === null) return after.state === "open" ? ["opened", ...feedbackFirstSeen(after)] : [after.state];
  const changes: PrChange[] = [];
  if (before.state !== after.state) changes.push(after.state === "open" ? "reopened" : after.state);
  if (before.ci !== after.ci && (after.ci === "pass" || after.ci === "fail")) changes.push(after.ci === "pass" ? "ci-passed" : "ci-failed");
  if (before.review !== after.review && after.review !== "none") changes.push(after.review);
  return changes;
}

/**
 * The blocking review feedback a GitLab merge request already had when it was first read. why: a
 * review bot can open a discussion before the first read, and the snapshot that read saves holds
 * it, so no later read sees it change. why GitLab only: GitHub's first read stays as it was.
 */
function feedbackFirstSeen(pr: PrSnapshot): PrChange[] {
  return pr.forge === "gitlab" && (pr.review === "changes-requested" || pr.review === "unresolved-discussions") ? [pr.review] : [];
}

/** Whether a change request's CI is still running, so the watch reads it again on the next tick. why not `blocked`: nothing runs until a person plays the job. */
export const ciRunning = (pr: PrSnapshot): boolean => pr.state === "open" && pr.ci === "pending";

/** What CI says about a commit: a verdict that passed all but CI is judged with it. */
export const ciVerdictSchema = z.discriminatedUnion("kind", [
  /** There is no pull request to check. */
  z.object({ kind: z.literal("none") }),
  /** The pull request reported no checks at this commit, still none once GitHub had time to attach them. */
  z.object({ kind: z.literal("no-checks"), ...prNumberShape }),
  /** CI on the pull request passed at this commit. */
  z.object({ kind: z.literal("pass"), ...prNumberShape }),
  /** CI on the pull request failed at this commit; each failed check by name. */
  z.object({ kind: z.literal("fail"), ...prNumberShape, failedChecks: z.array(z.string()) }),
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
  if (status?.unavailable?.kind === "persistent") return { kind: "not-checked", reason: `${statusLabel(status.unavailable.forge)}: ${status.unavailable.reason}` };
  if (found !== null && found.snapshot.state !== "open" && found.handoffAtRead === id) return { kind: "not-checked", reason: `${prRef(found.snapshot)} was ${found.snapshot.state} before CI finished on this commit` };
  return { kind: "waiting", number: found?.snapshot.number ?? null };
}

/**
 * What CI finished as on the found snapshot's head commit; null while it may still be to come. why
 * zero checks wait until a read past the window still sees none: right after a push GitHub may not
 * have attached them yet, an unknown check state is not a pass, and time passing since a read
 * says nothing about what GitHub has now.
 */
function finishedOnHead({ snapshot: pr, headSeenAt, readAt }: PrFound): CiVerdict | null {
  const { forge, number } = pr;
  switch (pr.ci) {
    case "pass":
      return { kind: "pass", forge, number };
    case "fail":
      return { kind: "fail", forge, number, failedChecks: pr.failedChecks };
    // why settle now: a blocked pipeline waits on a person, never on time, so waiting would hold the
    // issue in Verifying for as long as nobody plays the job. Not checked passes the verdict and
    // says why; the merge still needs the job played.
    case "blocked":
      return { kind: "not-checked", reason: `${prRef(pr)}'s pipeline is blocked on a manual job nobody has played` };
    case "pending":
      return null;
    case "none":
      return readAt - headSeenAt >= CHECKS_GRACE_MS ? { kind: "no-checks", forge, number } : null;
    default:
      return pr.ci satisfies never;
  }
}

/** The longest a check or job name's code span runs, its backticks included. */
const NAME_SPAN_CAP = 100;

// Characters that would break a name out of its line or its code span, or hide or reorder what it
// says, and the whitespace around them: every control (C0 and C1, line breaks among them), every
// format character (zero-width characters and joiners, bidi marks, embeddings, overrides and
// isolates, the byte-order mark), every other bidi control, and line and paragraph separators.
const UNQUOTABLE = /[\s\p{Cc}\p{Cf}\p{Bidi_Control}\p{Zl}\p{Zp}]+/gu;

/**
 * Failed check or job names as text a manager or agent reads: each in a code span of its own, on
 * one line, at most 100 characters. why every name goes through here: they come from the branch's
 * own CI config, which an agent can write, so none may close its span, break its line, or read as
 * Markdown or an instruction around it. The names are stored as the forge gave them.
 */
export const checkNamesText = (names: readonly string[]): string => names.map((name) => `\`${quotable(name)}\``).join(", ");

/** A name with backticks made quotes and every run of whitespace and unquotable characters one space, cut to fit its span with an ellipsis. */
function quotable(name: string): string {
  const flat = [...name.replaceAll("`", "'").replace(UNQUOTABLE, " ").trim()];
  const room = NAME_SPAN_CAP - 2;
  return flat.length <= room ? flat.join("") : `${flat.slice(0, room - 1).join("")}…`;
}
