// REVIEW.md: errors show next to any data still displayed. Every read renders this above its
// retained data, never instead of it. While a retry is in flight the old error is hidden
// (code-explorer's settledError), so the notice does not flicker on Refresh.
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
