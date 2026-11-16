// Where the panel lives and its inner pages.
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

export const PANEL_ID = "regional-managers";
export const PANEL_PATH = "regional-managers";
/** The subPath of the New page. */
export const NEW_SUBPATH = "new";
/** One coordinating thread's pages are at `<page>/<coordinator id>`: its board and its memory. */
const COORDINATOR_PAGES = ["board", "memory"] as const;
type CoordinatorPage = (typeof COORDINATOR_PAGES)[number];

type PanelPage = { kind: "list" } | { kind: "new" } | { kind: CoordinatorPage; coordinatorId: CoordinatorId };

/** The page a subPath shows, as it appears in the URL. A path no page owns shows the list. */
export function pageOf(subPath: string): PanelPage {
  if (subPath === NEW_SUBPATH) return { kind: "new" };
  const [segment, id, ...rest] = subPath.split("/");
  const page = COORDINATOR_PAGES.find((kind) => kind === segment);
  const coordinatorId = coordinatorIdSchema.safeParse(id);
  if (page !== undefined && rest.length === 0 && coordinatorId.success) return { kind: page, coordinatorId: coordinatorId.data };
  return { kind: "list" };
}

/** The subPath of a coordinating thread's board or memory. */
export const coordinatorSubPath = (page: CoordinatorPage, id: CoordinatorId): string => `${page}/${id}`;
