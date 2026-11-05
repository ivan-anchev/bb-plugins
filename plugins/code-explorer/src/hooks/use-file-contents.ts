import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { ReadFile } from "../viewer-input.ts";
import { messageOf } from "./error-message.ts";

export type FileContentsState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; file: ReadFile };

export function useFileContents(environmentId: string, path: string): FileContentsState {
  const sdk = useSdk();
  const [state, setState] = useState<FileContentsState>({ status: "loading" });

  useEffect(
    function readWorkspaceFile() {
      const controller = new AbortController();
      const { signal } = controller;
      sdk.environments
        .get({ environmentId, signal })
        .then((environment) => {
          if (environment.path === null) throw new Error("The environment has no workspace on disk.");
          return sdk.files.read({
            hostId: environment.hostId,
            rootPath: environment.path,
            path: `${environment.path}/${path}`,
            signal,
          });
        })
        .then(
          (file) => setState({ status: "ready", file }),
          (error: unknown) => {
            if (!signal.aborted) setState({ status: "failed", message: messageOf(error) });
          },
        );
      return () => controller.abort();
    },
    [sdk, environmentId, path],
  );

  return state;
}
