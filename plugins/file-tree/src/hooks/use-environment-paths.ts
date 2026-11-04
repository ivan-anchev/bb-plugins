import { useCallback, useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { WorkspacePath } from "../tree-input.ts";

const PATH_LIMIT = 20000;

export type EnvironmentPathsState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; paths: WorkspacePath[]; truncated: boolean };

export function useEnvironmentPaths(environmentId: string) {
  const sdk = useSdk();
  const [state, setState] = useState<EnvironmentPathsState>({ status: "loading" });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    sdk.environments
      .paths({
        environmentId,
        includeFiles: "true",
        includeDirectories: "true",
        limit: String(PATH_LIMIT),
        signal: controller.signal,
      })
      .then(
        (result) => setState({ status: "ready", paths: result.paths, truncated: result.truncated }),
        (error: unknown) => {
          if (!controller.signal.aborted) setState({ status: "failed", message: messageOf(error) });
        },
      );
    return () => controller.abort();
  }, [sdk, environmentId, generation]);

  const refetch = useCallback(() => setGeneration((current) => current + 1), []);
  return { state, refetch };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
