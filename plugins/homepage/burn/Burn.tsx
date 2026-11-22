import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { burnContract, type BurnRange, type BurnSpend } from "../contract.ts";
import { BurnCard, type BurnView } from "./BurnCard.tsx";

const REFRESH_MS = 60_000;

export function Burn() {
  const [range, setRange] = useState<BurnRange>("7d");
  const week = experimental_useRpcQuery({ contract: burnContract, method: "burnSpend", input: { range: "7d" } });
  const month = experimental_useRpcQuery({ contract: burnContract, method: "burnSpend", input: { range: "30d" } });
  const query = range === "7d" ? week : month;
  useRefresh(query, range);
  return <BurnCard range={range} onRange={setRange} view={view(query.data, query.error?.message ?? null)} />;
}

function useRefresh(query: { isLoading: boolean; refetch: () => Promise<void> }, range: BurnRange): void {
  const latest = useRef(query);
  useEffect(() => {
    latest.current = query;
  });
  useEffect(() => {
    if (!latest.current.isLoading) void latest.current.refetch();
    const timer = setInterval(() => {
      if (!document.hidden) void latest.current.refetch();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [range]);
}

function view(data: BurnSpend | undefined, failure: string | null): BurnView {
  if (data?.status === "ready") return { kind: "ready", totals: data };
  if (data?.status === "unavailable") return { kind: "unavailable", message: data.message };
  if (failure !== null) return { kind: "unavailable", message: `Couldn’t read Burn: ${failure}` };
  return { kind: "loading" };
}
