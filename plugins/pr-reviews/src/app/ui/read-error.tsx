import type { ExperimentalRpcQueryState } from "@get-bb/plugin-sdk/app";
import { Notice } from "./notice.tsx";

type Read = Pick<ExperimentalRpcQueryState<unknown>, "error" | "isFetching">;

export function ReadError({ read, what }: { read: Read; what: string }) {
  const settledError = read.isFetching ? null : read.error;
  return settledError === null ? null : (
    <Notice tone="error">
      Could not load {what}: {settledError.message}
    </Notice>
  );
}
