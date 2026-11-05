import { useEffect, useRef } from "react";
import { experimental_useTabVisible } from "@get-bb/plugin-sdk/app";

export function useRefetchOnShow(refetch: () => unknown): void {
  const visible = experimental_useTabVisible();
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (visible && !wasVisible.current) refetch();
    wasVisible.current = visible;
  }, [visible, refetch]);
}
