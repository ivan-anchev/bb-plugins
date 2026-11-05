import type { ChangeTarget, WorkspaceStatus } from "../git.ts";

export type TargetChoice =
  | { kind: "all" }
  | { kind: "branch_committed" }
  | { kind: "uncommitted" }
  | { kind: "commit"; sha: string };

export type TargetOption = { key: string; label: string; monoPrefix: string | null; choice: TargetChoice };

type Commit = NonNullable<WorkspaceStatus["mergeBase"]>["commits"][number];

export const DEFAULT_TARGET: TargetChoice = { kind: "all" };

const ALL_CHANGES = optionOf({ kind: "all" }, "All changes");
const COMMITTED_CHANGES = optionOf({ kind: "branch_committed" }, "Committed changes");
const UNCOMMITTED_CHANGES = optionOf({ kind: "uncommitted" }, "Uncommitted changes");

export function targetOptionsOf(workspace: WorkspaceStatus): TargetOption[] {
  const commits = workspace.mergeBase?.commits ?? [];
  const hasUncommittedChanges = workspace.workingTree.fileCount > 0;
  return [
    ALL_CHANGES,
    ...(commits.length > 0 ? [COMMITTED_CHANGES] : []),
    ...(hasUncommittedChanges ? [UNCOMMITTED_CHANGES] : []),
    ...commits.map(commitOptionOf),
  ];
}

export function offeredTargetOf(choice: TargetChoice, options: readonly TargetOption[]): TargetOption {
  return options.find((option) => option.key === keyOf(choice)) ?? ALL_CHANGES;
}

export function changeTargetOf(choice: TargetChoice, workspace: WorkspaceStatus): ChangeTarget {
  const mergeBaseBranch = workspace.mergeBase?.mergeBaseBranch ?? workspace.branch.defaultBranch;
  switch (choice.kind) {
    case "all":
      return { type: "all", mergeBaseBranch };
    case "branch_committed":
      return { type: "branch_committed", mergeBaseBranch };
    case "uncommitted":
      return { type: "uncommitted" };
    case "commit":
      return { type: "commit", sha: choice.sha };
  }
}

function commitOptionOf(commit: Commit): TargetOption {
  return { ...optionOf({ kind: "commit", sha: commit.sha }, commit.subject), monoPrefix: commit.shortSha };
}

function optionOf(choice: TargetChoice, label: string): TargetOption {
  return { key: keyOf(choice), label, monoPrefix: null, choice };
}

function keyOf(choice: TargetChoice): string {
  return choice.kind === "commit" ? `commit:${choice.sha}` : choice.kind;
}
