// Opening an issue's tab: its address in the side panel and the params bb opens it with. bb stores a
// tab's params, which bring it back after a reload, and keys the tab by them, so opening an issue
// whose tab is open focuses that tab rather than adding a second one.
import { experimental_useAppPanel, type ExperimentalOpenTabOptions } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { IssueRow } from "../../../contract.ts";
import { issueIdSchema, type IssueId } from "../../../model/issue/issue.ts";

/** The tab's address, for `openTab`. */
export const ISSUE_TAB = { id: "issue", context: { kind: "thread" }, availability: "action" } as const;

/** What a tab is opened with and keyed by: its issue. why parsed: bb hands back what it stored, whichever version of the plugin stored it. */
export const issueTabParamsSchema = z.object({ issueId: issueIdSchema });
type IssueTabParams = z.infer<typeof issueTabParamsSchema>;

/** Opens an issue's tab beside the Board, or focuses its tab when it has one. */
export function useOpenIssue(): (issue: IssueRow) => void {
  const panel = experimental_useAppPanel();
  return (issue) => panel.openTab(issueTabOf(issue.id, issue.title));
}

/** What opens an issue's tab in any thread pane's panel, titled with its id and title, or its id alone while its title is unknown (null). */
export function issueTabOf(issueId: IssueId, title: string | null): ExperimentalOpenTabOptions {
  const params: IssueTabParams = { issueId };
  return { tab: ISSUE_TAB, params, title: title === null ? issueId : `${issueId} ${title}` };
}
