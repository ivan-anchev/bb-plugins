// Opening an issue's tab: its address in the side panel and the params bb opens it with. bb stores a
// tab's params, which bring it back after a reload, and keys the tab by them, so opening an issue
// whose tab is open focuses that tab rather than adding a second one.
import { experimental_useAppPanel } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { IssueRow } from "../../../contract.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";

/** The tab's address, for `openTab`. */
export const ISSUE_TAB = { id: "issue", context: { kind: "thread" }, availability: "action" } as const;

/** What a tab is opened with and keyed by: its issue. why parsed: bb hands back what it stored, whichever version of the plugin stored it. */
export const issueTabParamsSchema = z.object({ issueId: issueIdSchema });
type IssueTabParams = z.infer<typeof issueTabParamsSchema>;

/** Opens an issue's tab beside the Board, titled with its id and title, or focuses its tab when it has one. */
export function useOpenIssue(): (issue: IssueRow) => void {
  const panel = experimental_useAppPanel();
  return (issue) => {
    const params: IssueTabParams = { issueId: issue.id };
    panel.openTab({ tab: ISSUE_TAB, params, title: `${issue.id} ${issue.title}` });
  };
}
