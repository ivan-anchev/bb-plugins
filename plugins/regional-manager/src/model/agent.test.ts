import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, branchOf, cutPlan, environmentOf, handoverOf, placementOf, refOf, type Agent, type EnvironmentProvider, type Handover, type Placement, type Previous } from "./agent.ts";
import { issueIdSchema } from "./issue/issue.ts";
import { coordinatorIdSchema } from "./role.ts";
import type { CheckoutRead } from "./verdict/checkout.ts";
import type { PrSnapshot } from "./verdict/pr.ts";

const boat: EnvironmentProvider = {
  id: "boat-sandbox",
  inputs: {},
  acceptsEmptyInputs: true,
  environmentProviderId: "project-checkout",
  machineProviderId: "boat",
  machineInputs: {},
  machineAcceptsEmptyInputs: true,
};
const personal: EnvironmentProvider = { id: "personal", inputs: null, acceptsEmptyInputs: true, machineProviderId: null };

function placed(result: Placement | { refused: string }): Placement {
  if ("refused" in result) assert.fail(result.refused);
  return result;
}

test("a sandbox gets a new machine and a new branch from the default branch; a provider that takes no inputs gets none", () => {
  const sandbox = placed(placementOf({ kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } }, { providers: [boat, personal], defaultBranch: "main" }));
  assert.deepEqual(environmentOf(sandbox, null, null), {
    type: "provider",
    environmentProviderId: "boat-sandbox",
    inputs: { branch: { kind: "new", baseBranch: "main" } },
    machine: { type: "new", machineProviderId: "boat", inputs: { preset: "small" } },
  });
  const none = placed(placementOf({ kind: "provider", environmentProviderId: "personal" }, { providers: [boat, personal], defaultBranch: "main" }));
  assert.deepEqual(environmentOf(none, null, null), { type: "provider", environmentProviderId: "personal", inputs: null });
});

test("a worktree runs on the regional manager's machine, from the default branch", () => {
  assert.deepEqual(environmentOf({ kind: "worktree" }, "host_1", null), { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
});

test("a placement bb can't run is refused with what it can", () => {
  assert.deepEqual(placementOf({ kind: "provider", environmentProviderId: "modal" }, { providers: [boat, personal], defaultBranch: "main" }), { refused: "bb has no environment provider modal. It has: boat-sandbox, personal." });
  assert.deepEqual(placementOf({ kind: "provider", environmentProviderId: "boat-sandbox" }, { providers: [boat], defaultBranch: null }), {
    refused: "bb records no default branch for this project, so the agent's branch can't be made from it. Use a worktree placement.",
  });
});

test("an agent's branch is the one read at its handoff, else the one bb made its environment on", () => {
  const unread = { checkout: { environmentId: null, branch: null, head: null } };
  assert.equal(branchOf(unread, { environmentBranchName: "bb/retries" }), "bb/retries");
  assert.equal(branchOf({ checkout: { environmentId: "env_1", branch: "fix/retries", head: "a".repeat(40) } }, { environmentBranchName: "bb/retries" }), "fix/retries");
  assert.equal(branchOf(unread, null), null);
});

const sandboxAgent: Agent = {
  id: agentIdSchema.parse("a3"),
  coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
  issueId: issueIdSchema.parse("i5"),
  placement: { kind: "provider", environmentProviderId: "boat-sandbox", inputs: { kind: "new-branch", baseBranch: "main" }, machine: { machineProviderId: "boat", inputs: { preset: "small" } } },
  base: { kind: "default" },
  execution: { providerId: "codex", model: "gpt-5.4", reasoningLevel: "high" },
  threadId: "thr_a3",
  checkout: { environmentId: "env_sbx", branch: "bb/a3", head: "c".repeat(40) },
  fixRounds: 1,
  startedAt: 2_000,
  ended: null,
};
const HEAD_C = "c".repeat(40);
const HEAD_D = "d".repeat(40);
const sandbox: Placement = sandboxAgent.placement;
const worktree: Placement = { kind: "worktree" };
const worktreeAgent: Agent = { ...sandboxAgent, placement: worktree, checkout: { environmentId: "env_wt", branch: "bb/a3", head: HEAD_C } };
/** bb's git plugin's read of a live environment: its head, its changed files as `git status --short` lists them, and the branch checked out (null: detached). */
const readAt = (headSha: string, changedFiles: string[] = [], branch: string | null = "bb/a3"): CheckoutRead => ({ kind: "read", branch, checkout: { headSha, changedFiles, changedFileCount: changedFiles.length } });
const clean = readAt(HEAD_C);
const previous: Previous = { agent: sandboxAgent, environmentId: "env_sbx", branch: "bb/a3", now: null, pushed: null };
const prAt = (headSha: string): PrSnapshot => ({ number: 44, url: "https://github.com/acme/webhooks/pull/44", state: "open", draft: false, review: "none", ci: "pass", headSha, failedChecks: [] });

test("a handover continues in the previous agent's environment, whatever made it, inheriting its checkout and placement", () => {
  assert.deepEqual(handoverOf("build", { from: "previous", placement: null }, previous), {
    kind: "join",
    base: { kind: "joined", from: "a3" },
    placement: sandboxAgent.placement,
    environment: { type: "reuse", environmentId: "env_sbx" },
    checkout: { environmentId: "env_sbx", branch: "bb/a3", head: HEAD_C },
  });
});

test("a first agent, from default, and a kind that ships no code start clean, a placement named included", () => {
  assert.deepEqual(handoverOf("build", { from: "previous", placement: worktree }, null), { kind: "clean" });
  assert.deepEqual(handoverOf("build", { from: "default", placement: worktree }, previous), { kind: "clean" });
  assert.deepEqual(handoverOf("research", { from: "previous", placement: worktree }, previous), { kind: "clean" });
});

/** The handover's refusal; fails on anything else. */
function refusal(handover: Handover | { refused: string }): string {
  if (!("refused" in handover)) assert.fail(`not refused: ${JSON.stringify(handover)}`);
  return handover.refused;
}

/** The cut a handover makes, with the environment bb would spawn it in on host_1; fails on anything else. */
function cutOf(handover: Handover | { refused: string }) {
  if ("refused" in handover || handover.kind !== "cut") assert.fail(`not a cut: ${JSON.stringify(handover)}`);
  return { base: handover.base, environment: environmentOf(handover.placement, "host_1", refOf(handover.base)) };
}

// cutRef's rows, in its order (issue 06): a provider that takes no branch; a gone environment with no
// branch on record; a live environment that can't be read, has no branch checked out or holds
// uncommitted files; worktree to worktree from the local branch; else origin, once a pull request
// shows the head pushed.

test("cut 1: a removed environment with no branch on record can't be moved: refused, offering a clean start; a live one moves from the branch it has checked out", () => {
  const gone = refusal(handoverOf("build", { from: "previous", placement: null }, { ...previous, environmentId: null, branch: null }));
  assert.equal(gone, 'a3 has no branch on record, so a new environment has nothing to start from: start clean with from: "default", which starts from the default branch with every earlier handoff and verdict in the new agent\'s first message.');
  const alive = cutOf(handoverOf("build", { from: "previous", placement: worktree }, { agent: worktreeAgent, environmentId: "env_wt", branch: null, now: clean, pushed: null }));
  assert.deepEqual(alive.base, { kind: "cut", from: "a3", branch: "bb/a3", pushed: null });
});

test("cut 1: a live environment's branch and head both come from the read: another branch checked out is the one cut, and a detached HEAD is refused, offering the continue", () => {
  const switched = readAt(HEAD_D, [], "bb/a3-retry");
  const local = cutOf(handoverOf("build", { from: "previous", placement: worktree }, { agent: worktreeAgent, environmentId: "env_wt", branch: "bb/a3", now: switched, pushed: null }));
  assert.deepEqual(local.base, { kind: "cut", from: "a3", branch: "bb/a3-retry", pushed: null });
  assert.deepEqual(cutPlan({ ...previous, now: switched }, worktree), { prove: { branch: "bb/a3-retry", head: HEAD_D } }, "through origin, the proof is asked of the branch checked out, at its head");

  const detached = refusal(handoverOf("build", { from: "previous", placement: worktree }, { ...previous, now: readAt(HEAD_D, [], null), pushed: { kind: "read", pr: prAt(HEAD_D) } }));
  assert.equal(detached, "a3's environment has no branch checked out (HEAD is detached at ddddddd), so a new environment has none to start from. Continue in it (leave out placement), or ask a3 to check out a branch with its commits, then call again.");
});

test("cut 2: a provider that takes no branch can't carry the work: refused, offering a clean start", () => {
  const personalPlace: Placement = { kind: "provider", environmentProviderId: "personal", inputs: { kind: "none" }, machine: null };
  assert.match(refusal(handoverOf("build", { from: "previous", placement: personalPlace }, { ...previous, now: clean })), /^personal takes no branch, so an agent there can't start from a3's: continue in its environment \(leave out placement\), or start clean with from: "default"/);
});

test("cut 3: a live environment that can't be read, or holds uncommitted files, is refused naming why or them, offering the continue", () => {
  const asleep = refusal(handoverOf("build", { from: "previous", placement: worktree }, { ...previous, now: { kind: "unread", reason: "Host is suspended" } }));
  assert.equal(asleep, "bb's git plugin can't read a3's environment now (Host is suspended), so what a3 left uncommitted there is unknown. Continue in it instead (leave out placement; that wakes a sleeping sandbox), or call again once it can be read.");
  const dirty = readAt(HEAD_C, ["?? notes.txt", " M src/retry.ts"]);
  assert.equal(
    refusal(handoverOf("build", { from: "previous", placement: worktree }, { ...previous, now: dirty, pushed: { kind: "read", pr: prAt(HEAD_C) } })),
    "a3 left 2 files uncommitted (?? notes.txt,  M src/retry.ts) in its environment, which a new environment wouldn't get. Continue in it (leave out placement), or ask a3 to commit them, then call again.",
  );
});

test("cut 4: worktree to worktree cuts from the local branch, live or gone, with no push proof", () => {
  const live = cutOf(handoverOf("build", { from: "previous", placement: worktree }, { agent: worktreeAgent, environmentId: "env_wt", branch: "bb/a3", now: clean, pushed: null }));
  assert.deepEqual(live.base, { kind: "cut", from: "a3", branch: "bb/a3", pushed: null });
  assert.deepEqual(live.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "bb/a3" } } });
  const gone = cutOf(handoverOf("build", { from: "previous", placement: null }, { agent: worktreeAgent, environmentId: null, branch: "bb/a3", now: null, pushed: null }));
  assert.deepEqual(gone.environment, live.environment, "a worktree whose environment bb removed moves to a new worktree");
});

test("cut 5: with a sandbox on either side it cuts from origin once the branch's pull request has the head the agent left", () => {
  const out = cutOf(handoverOf("build", { from: "previous", placement: worktree }, { ...previous, now: clean, pushed: { kind: "read", pr: prAt(HEAD_C) } }));
  assert.deepEqual(out.base, { kind: "cut", from: "a3", branch: "bb/a3", pushed: HEAD_C });
  assert.deepEqual(out.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "origin/bb/a3" } } });

  const sandboxPlace = placed(placementOf({ kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } }, { providers: [boat], defaultBranch: "main" }));
  const into = cutOf(handoverOf("build", { from: "previous", placement: sandboxPlace }, { agent: worktreeAgent, environmentId: "env_wt", branch: "bb/a3", now: clean, pushed: { kind: "read", pr: prAt(HEAD_C) } }));
  assert.deepEqual(into.environment, { type: "provider", environmentProviderId: "boat-sandbox", inputs: { branch: { kind: "new", baseBranch: "origin/bb/a3" } }, machine: { type: "new", machineProviderId: "boat", inputs: { preset: "small" } } });

  const reaped = cutOf(handoverOf("build", { from: "previous", placement: null }, { ...previous, environmentId: null, pushed: { kind: "read", pr: prAt(HEAD_C) } }));
  assert.deepEqual(reaped.environment, { ...into.environment, machine: { type: "new", machineProviderId: "boat", inputs: { preset: "small" } } }, "a sandbox bb removed moves to a new one of the same provider and preset, from its last handoff's head");
});

test("cut 6: a head no pull request shows is refused: push and open one, or continue; a removed sandbox's is lost, offering a clean start; a removed worktree's is still on its branch, offering a worktree", () => {
  const behind = readAt(HEAD_D);
  const alive = refusal(handoverOf("build", { from: "previous", placement: worktree }, { ...previous, now: behind, pushed: { kind: "read", pr: prAt(HEAD_C) } }));
  assert.equal(
    alive,
    "a3's branch `bb/a3` isn't shown on origin at its head ddddddd: a move with a sandbox on either side reaches the branch only through origin, and only a pull request whose head is that commit shows it was pushed. Continue in its environment (leave out placement), or ask a3 to push and open a pull request, then call again.",
  );
  const gone = refusal(handoverOf("build", { from: "previous", placement: null }, { ...previous, environmentId: null, pushed: { kind: "read", pr: null } }));
  assert.equal(
    gone,
    'bb removed a3\'s boat-sandbox environment, and nothing shows its branch `bb/a3` reached origin at its head ccccccc (no pull request has that head): its unpushed commits went with it. Start clean with from: "default", which starts from the default branch with every earlier handoff and verdict in the new agent\'s first message.',
  );
  const never = refusal(handoverOf("build", { from: "previous", placement: null }, { ...previous, environmentId: null, agent: { ...sandboxAgent, checkout: { ...sandboxAgent.checkout, head: null } } }));
  assert.match(never, /reached origin at the head it left \(no pull request has that head\): its unpushed commits went with it\. Start clean/);
  const worktreeGone = refusal(handoverOf("build", { from: "previous", placement: sandbox }, { agent: worktreeAgent, environmentId: null, branch: "bb/a3", now: null, pushed: { kind: "read", pr: null } }));
  assert.equal(
    worktreeGone,
    'bb removed a3\'s worktree, and nothing shows its branch `bb/a3` reached origin at its head ccccccc (no pull request has that head): its commits are still on that branch on your machine, which a new worktree reaches. Leave out placement, or name a worktree, and the new agent starts on a branch cut from it; it can push and open its pull request, and a move to a sandbox works after that. Or start clean with from: "default", which starts from the default branch with every earlier handoff and verdict in the new agent\'s first message.',
  );
});

test("cut 7: a pull request GitHub couldn't be read for is refused saying why, never as unpushed", () => {
  const unread = refusal(handoverOf("build", { from: "previous", placement: worktree }, { ...previous, now: clean, pushed: { kind: "unread", reason: "gh isn't signed in" } }));
  assert.equal(unread, "Whether a3's branch `bb/a3` is on origin at its head ccccccc can't be read now: gh isn't signed in. Continue in its environment (leave out placement), or call again once GitHub can be read.");
});

test("a cut through origin asks for proof at the live head, else at the head of the agent's last handoff; a local cut and a refusal ask for none", () => {
  const live = readAt(HEAD_D);
  assert.deepEqual(cutPlan({ ...previous, now: live }, worktree), { prove: { branch: "bb/a3", head: HEAD_D } });
  assert.deepEqual(cutPlan({ ...previous, environmentId: null }, sandbox), { prove: { branch: "bb/a3", head: HEAD_C } });
  assert.deepEqual(cutPlan({ agent: worktreeAgent, environmentId: null, branch: "bb/a3", now: null }, worktree), { kind: "cut", from: "a3", branch: "bb/a3", pushed: null });
  assert.ok("refused" in cutPlan({ ...previous, now: { kind: "unread", reason: "Host is suspended" } }, worktree));
});
