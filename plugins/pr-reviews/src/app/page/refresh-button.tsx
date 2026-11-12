// headerContent: one Refresh for the whole screen. bb's plugin-wide refresh re-reads every read on
// screen, a cached failure included (REVIEW.md): the sidebar's PRs, the PR, its diff once
// the Changes tab has read it, the selected file's text and the guide. A read not yet enabled,
// such as the diff of a Changes tab never opened, stays unread.
import { experimental_useRpcRefresh } from "@get-bb/plugin-sdk/app";
import { IconButton } from "../ui/icon-button.tsx";

export function RefreshButton() {
  const { refresh, isRefreshing } = experimental_useRpcRefresh();
  return <IconButton icon="RotateCcw" label="Refresh" disabled={isRefreshing} onClick={refresh} />;
}
