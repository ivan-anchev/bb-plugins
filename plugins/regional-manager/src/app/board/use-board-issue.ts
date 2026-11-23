// One issue of a regional manager's board, from the board's read, which its tabs, its links in chat
// and its hover cards all share, so each changes as the board does.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract } from "../../contract.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** The board's read, its issues (undefined until read) and the issue among them (undefined until read, or when it has none by that id). */
export function useBoardIssue(coordinatorId: CoordinatorId, issueId: IssueId) {
  const read = experimental_useRpcQuery({ contract, method: "board", input: { coordinatorId } });
  const issues = read.data?.issues;
  return { read, issues, issue: issues?.find(({ id }) => id === issueId) };
}
