// Where the panel lives and its inner pages.
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

export const PANEL_ID = "regional-managers";
export const PANEL_PATH = "regional-managers";
/** The subPath of the New page. */
export const NEW_SUBPATH = "new";
/** The segment of a regional manager's page, at `board/<coordinator id>`: its board once started, its goal's composer until then. */
const MANAGER_SEGMENT = "board";

type PanelPage = { kind: "list" } | { kind: "new" } | { kind: "manager"; coordinatorId: CoordinatorId };

/** The page a subPath shows, as it appears in the URL. A path no page owns shows the list. */
export function pageOf(subPath: string): PanelPage {
  if (subPath === NEW_SUBPATH) return { kind: "new" };
  const [segment, id, ...rest] = subPath.split("/");
  const coordinatorId = coordinatorIdSchema.safeParse(id);
  if (segment === MANAGER_SEGMENT && rest.length === 0 && coordinatorId.success) return { kind: "manager", coordinatorId: coordinatorId.data };
  return { kind: "list" };
}

/** The subPath of a regional manager's page. */
export const managerSubPath = (id: CoordinatorId): string => `${MANAGER_SEGMENT}/${id}`;
