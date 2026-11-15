// Where the panel lives and its inner pages.
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";

export const PANEL_ID = "coordinators";
export const PANEL_PATH = "coordinators";
/** The subPath of the New page. */
export const NEW_SUBPATH = "new";
/** One coordinating thread's memory is at `memory/<coordinator id>`. */
const MEMORY_SEGMENT = "memory";

type PanelPage = { kind: "list" } | { kind: "new" } | { kind: "memory"; coordinatorId: CoordinatorId };

/** The page a subPath shows, as it appears in the URL. A path no page owns shows the list. */
export function pageOf(subPath: string): PanelPage {
  if (subPath === NEW_SUBPATH) return { kind: "new" };
  const [segment, id, ...rest] = subPath.split("/");
  const coordinatorId = coordinatorIdSchema.safeParse(id);
  if (segment === MEMORY_SEGMENT && rest.length === 0 && coordinatorId.success) return { kind: "memory", coordinatorId: coordinatorId.data };
  return { kind: "list" };
}

/** The subPath of a coordinating thread's memory. */
export const memorySubPath = (id: CoordinatorId): string => `${MEMORY_SEGMENT}/${id}`;
