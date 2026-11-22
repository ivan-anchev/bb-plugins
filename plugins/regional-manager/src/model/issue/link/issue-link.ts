// An issue's link: the way a regional manager names an issue to the user, as a Markdown link to a
// route of the plugin's panel, `/plugins/regional-manager/regional-managers/issue/<coordinatorId>/<issueId>`.
// The plugin's id is bb's to give (`bb.pluginId`, `experimental_usePluginId()`), so every function
// here takes it. In chat the plugin's overlay draws it as the issue's live status and id (app/chat-links); where
// the overlay doesn't run, the route opens the issue (app/panel/routes.ts), and without the plugin it
// reads as its id. why the regional manager's id in it: issue keys repeat across managers, as two in
// one project both have BBP-4.
import { coordinatorIdSchema, type CoordinatorId } from "../../role.ts";
import { issueIdSchema, type IssueId } from "../issue.ts";

/** The path of the plugin's panel in bb's navigation rail, which issue links lead into. */
export const PANEL_PATH = "regional-managers";

/** An issue, as a link names it. */
export type IssueLink = { coordinatorId: CoordinatorId; issueId: IssueId };

/** The issue's route in the app of the plugin `pluginId`: the panel's path, then the issue's subPath. */
export const issueHref = (pluginId: string, { coordinatorId, issueId }: IssueLink): string => `${panelRoute(pluginId)}${ISSUE_SEGMENT}/${coordinatorId}/${issueId}`;

/** The issue's link as a manager writes it to the user: its id, linked to its route. */
export const issueLinkMarkdown = (pluginId: string, link: IssueLink): string => `[${link.issueId}](${issueHref(pluginId, link)})`;

/** The issue an href names, exactly as `issueHref` writes it for `pluginId`; null for any other. */
export function parseIssueHref(pluginId: string, href: string): IssueLink | null {
  const route = panelRoute(pluginId);
  return href.startsWith(route) ? parseIssueSubPath(href.slice(route.length)) : null;
}

/** The issue a subPath of the panel names (`issue/<coordinatorId>/<issueId>`); null for any other. */
export function parseIssueSubPath(subPath: string): IssueLink | null {
  const [segment, coordinator, issue, ...rest] = subPath.split("/");
  const coordinatorId = coordinatorIdSchema.safeParse(coordinator);
  const issueId = issueIdSchema.safeParse(issue);
  if (segment !== ISSUE_SEGMENT || rest.length > 0 || !coordinatorId.success || !issueId.success) return null;
  return { coordinatorId: coordinatorId.data, issueId: issueId.data };
}

// ------------------------------------------------------------------ layer 2

/** The panel's subPath of an issue. */
const ISSUE_SEGMENT = "issue";

/** Every route into the panel starts so. */
const panelRoute = (pluginId: string): string => `/plugins/${pluginId}/${PANEL_PATH}/`;
