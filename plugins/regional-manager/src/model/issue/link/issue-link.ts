// An issue's link: the way a regional manager names an issue to the user, as a Markdown link to a
// route of the plugin's panel, `/plugins/regional-manager/regional-managers/issue/<coordinatorId>/<issueId>`.
// In chat the plugin's overlay draws it as the issue's live status and id (app/chat-links); where
// the overlay doesn't run, the route opens the issue (app/panel/routes.ts), and without the plugin it
// reads as its id. why the regional manager's id in it: issue keys repeat across managers, as two in
// one project both have BBP-4.
import manifest from "../../../../package.json" with { type: "json" };
import { coordinatorIdSchema, type CoordinatorId } from "../../role.ts";
import { issueIdSchema, type IssueId } from "../issue.ts";

/** The path of the plugin's panel in bb's navigation rail, which issue links lead into. */
export const PANEL_PATH = "regional-managers";

/** An issue, as a link names it. */
export type IssueLink = { coordinatorId: CoordinatorId; issueId: IssueId };

/** The issue's route in the app: the panel's path, then the issue's subPath. */
export const issueHref = (coordinatorId: CoordinatorId, issueId: IssueId): string => `${PANEL_ROUTE}${issueSubPath(coordinatorId, issueId)}`;

/** The issue's link as a manager writes it to the user: its id, linked to its route. */
export const issueLinkMarkdown = (coordinatorId: CoordinatorId, issueId: IssueId): string => `[${issueId}](${issueHref(coordinatorId, issueId)})`;

/** The issue an href names, exactly as `issueHref` writes it; null for any other. */
export function parseIssueHref(href: string): IssueLink | null {
  return href.startsWith(PANEL_ROUTE) ? parseIssueSubPath(href.slice(PANEL_ROUTE.length)) : null;
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

const issueSubPath = (coordinatorId: CoordinatorId, issueId: IssueId): string => `${ISSUE_SEGMENT}/${coordinatorId}/${issueId}`;

/** The plugin's id, as bb derives it from the package's name. */
const PLUGIN_ID = manifest.name.replace(/^bb-plugin-/, "");

/** Every route into the panel starts so. */
const PANEL_ROUTE = `/plugins/${PLUGIN_ID}/${PANEL_PATH}/`;
