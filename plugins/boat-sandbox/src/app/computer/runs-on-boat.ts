// Whether a thread's environment runs on a boat sandbox: the one read the Computer card and the Computer
// tab's New tab row share. It asks bb only, never boat, so showing them never starts boat's desktop view.
import { useMemo } from "react";
import { experimental_useRpcKeyedQuery, type ExperimentalThreadEnvironment } from "@get-bb/plugin-sdk/app";
import { boatSandboxContract as contract } from "../../contract.ts";

/** False until the read answers, and for a thread with no environment. */
export function useRunsOnBoat(environment: ExperimentalThreadEnvironment | null): boolean {
  const id = environment?.id ?? null;
  const keys = useMemo(() => (id === null ? [] : [id]), [id]);
  const query = experimental_useRpcKeyedQuery({ contract, method: "boatEnvironments", keys, enabled: id !== null });
  return id !== null && query.data?.[id] === true;
}
