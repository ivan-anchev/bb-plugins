import assert from "node:assert/strict";
import { test } from "node:test";
import { branchOf, environmentOf, placementOf, type EnvironmentProvider, type Placement } from "./agent.ts";

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
