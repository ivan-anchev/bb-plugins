import { useCallback } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

export function useOpenFile(environmentId: string) {
  const navigate = useBbNavigate();
  return useCallback(
    (path: string, ref?: string) => {
      navigate.experimental_openFilePreview({
        target: { kind: "workspace", environmentId, path, ...(ref === undefined ? {} : { experimental_ref: ref }) },
        location: null,
      });
    },
    [navigate, environmentId],
  );
}
