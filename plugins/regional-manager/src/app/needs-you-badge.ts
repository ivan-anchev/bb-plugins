// The rail badge: what sits under Needs you on the board of every coordinating thread the panel
// lists. Each board's count reads again whenever that board does, so an answer drops it at once.
import {
  experimental_useRpcKeyedQuery,
  experimental_useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
  type ExperimentalBadge,
} from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract } from "../contract.ts";
import { needsYouBadge } from "./needs-you-label.ts";
import { listView } from "./panel/coordinator-groups.ts";

const UNREAD = { label: "Could not read what needs you" };

export function useNeedsYouBadge(): ExperimentalBadge | null {
  // why the panel's list: the badge counts the boards it lists, and only those (an archived thread's board can't be opened).
  const view = listView(experimental_useRpcQuery({ contract, method: "coordinators", input: {} }), useSidebarThreads());
  const keys = view.kind === "listed" ? view.groups.flatMap((group) => group.rows.map((row) => row.coordinator.id)) : [];
  const read = experimental_useRpcKeyedQuery({ contract, method: "needsYou", keys, enabled: keys.length > 0 });
  // why a dot: a failed read never passes for nothing waiting.
  if (view.kind === "failed" || read.error !== null) return UNREAD;
  return needsYouBadge(keys.flatMap((key) => read.data?.[key] ?? []));
}
