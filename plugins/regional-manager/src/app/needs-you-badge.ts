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
  const live = useSidebarThreads();
  const view = listView(experimental_useRpcQuery({ contract, method: "coordinators", input: {} }), live);
  const keys = view.kind === "listed" ? view.groups.flatMap((group) => group.rows.map((row) => row.coordinator.id)) : [];
  const read = experimental_useRpcKeyedQuery({ contract, method: "needsYou", keys, enabled: keys.length > 0 });
  if (view.kind === "failed" || live.status === "error" || read.error !== null) return UNREAD;
  return needsYouBadge(keys.flatMap((key) => read.data?.[key] ?? []));
}
