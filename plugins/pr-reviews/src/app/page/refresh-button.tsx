import { experimental_useRpcRefresh } from "@get-bb/plugin-sdk/app";
import { IconButton } from "../ui/icon-button.tsx";

export function RefreshButton() {
  const { refresh, isRefreshing } = experimental_useRpcRefresh();
  return <IconButton icon="RotateCcw" label="Refresh" disabled={isRefreshing} onClick={refresh} />;
}
