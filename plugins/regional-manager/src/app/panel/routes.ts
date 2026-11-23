// Where the panel lives and its inner pages. Its path is its issue links' (model/issue/link).
import { parseIssueSubPath, type IssueLink } from "../../model/issue/link/issue-link.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

export const PANEL_ID = "regional-managers";
/** The subPath of the New page. */
export const NEW_SUBPATH = "new";
/**
 * The segment of a regional manager's page, at `board/<coordinator id>`: its goal's composer until it
 * starts. why "board": 0.4.0 linked a started one's board there, and such a link now opens its thread.
 */
const MANAGER_SEGMENT = "board";

/** `issue`: an issue link followed where the plugin's chat overlay didn't catch it (chat-links/issue-landing.tsx). */
type PanelPage = { kind: "list" } | { kind: "new" } | { kind: "manager"; coordinatorId: CoordinatorId } | { kind: "issue"; link: IssueLink };

/** The page a subPath shows, as it appears in the URL. A path no page owns shows the list. */
export function pageOf(subPath: string): PanelPage {
  if (subPath === NEW_SUBPATH) return { kind: "new" };
  const link = parseIssueSubPath(subPath);
  if (link !== null) return { kind: "issue", link };
  const [segment, id, ...rest] = subPath.split("/");
  const coordinatorId = coordinatorIdSchema.safeParse(id);
  if (segment === MANAGER_SEGMENT && rest.length === 0 && coordinatorId.success) return { kind: "manager", coordinatorId: coordinatorId.data };
  return { kind: "list" };
}

/** The subPath of a regional manager's page. */
export const managerSubPath = (id: CoordinatorId): string => `${MANAGER_SEGMENT}/${id}`;
