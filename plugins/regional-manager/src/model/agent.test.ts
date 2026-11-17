import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, branchOf, environmentOf, handoverOf, placementOf, type Agent, type EnvironmentProvider, type Placement, type Previous } from "./agent.ts";
import { issueIdSchema } from "./issue/issue.ts";
import { coordinatorIdSchema } from "./role.ts";

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
  assert.deepEqual(environmentOf(sandbox, null), {
    type: "provider",
    environmentProviderId: "boat-sandbox",
    inputs: { branch: { kind: "new", baseBranch: "main" } },
    machine: { type: "new", machineProviderId: "boat", inputs: { preset: "small" } },
  });
  const none = placed(placementOf({ kind: "provider", environmentProviderId: "personal" }, { providers: [boat, personal], defaultBranch: "main" }));
  assert.deepEqual(environmentOf(none, null), { type: "provider", environmentProviderId: "personal", inputs: null });
});

test("a worktree runs on the regional manager's machine, from the default branch", () => {
  assert.deepEqual(environmentOf({ kind: "worktree" }, "host_1"), { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
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
const previous: Previous = { agent: sandboxAgent, environmentId: "env_sbx", branch: "bb/a3" };

test("a handover continues in the previous agent's environment, whatever made it, inheriting its checkout and placement", () => {
  assert.deepEqual(handoverOf("build", { from: "previous", placement: undefined }, previous), {
    kind: "join",
    base: { kind: "joined", from: "a3" },
    placement: sandboxAgent.placement,
    environment: { type: "reuse", environmentId: "env_sbx" },
    checkout: { environmentId: "env_sbx", branch: "bb/a3", head: "c".repeat(40) },
  });
});

test("a first agent, from default, and a kind that ships no code start clean, a placement named included", () => {
  const worktree = { kind: "worktree" } as const;
  assert.deepEqual(handoverOf("build", { from: "previous", placement: worktree }, null), { kind: "clean" });
  assert.deepEqual(handoverOf("build", { from: "default", placement: worktree }, previous), { kind: "clean" });
  assert.deepEqual(handoverOf("research", { from: "previous", placement: undefined }, previous), { kind: "clean" });
});

test("a continue that would move the work, to a placement named or because bb removed the environment, is refused offering a clean start", () => {
  const named = handoverOf("build", { from: "previous", placement: { kind: "worktree" } }, previous);
  const gone = handoverOf("build", { from: "previous", placement: undefined }, { ...previous, environmentId: null });
  for (const refused of [named, gone]) assert.ok("refused" in refused && refused.refused.includes('start clean with from: "default"'), JSON.stringify(refused));
});
