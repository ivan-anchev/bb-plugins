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
