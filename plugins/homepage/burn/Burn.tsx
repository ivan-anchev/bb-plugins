// The Burn card's data: Burn's spend and tokens for the week and the month, read through this plugin's
// server (the app's rpc hooks call only their own plugin). Both ranges load up front, so the switch
// never waits; the one on show reads again every minute while the page is visible.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { burnContract, type BurnRange, type BurnSpend } from "../contract.ts";
import { BurnCard, type BurnView } from "./BurnCard.tsx";

/** Burn's numbers move with every model call, so an open homepage reads them again about once a minute. */
const REFRESH_MS = 60_000;

export function Burn() {
  const [range, setRange] = useState<BurnRange>("7d");
  const week = experimental_useRpcQuery({ contract: burnContract, method: "burnSpend", input: { range: "7d" } });
  const month = experimental_useRpcQuery({ contract: burnContract, method: "burnSpend", input: { range: "30d" } });
  const query = range === "7d" ? week : month;
  useRefresh(query, range);
  return <BurnCard range={range} onRange={setRange} view={view(query.data, query.error?.message ?? null)} />;
}

/**
 * Reads the range on show again when it comes into view (the switch, or a return to the homepage with
 * numbers cached), never on top of its first read, then every minute while the page is visible.
 * why a ref: the effect runs per range, not per render, whatever the hook hands back each render.
 */
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

/** A failed refresh keeps the last good numbers; only a failure with nothing to show says so. */
function view(data: BurnSpend | undefined, failure: string | null): BurnView {
  if (data?.status === "ready") return { kind: "ready", totals: data };
  if (data?.status === "unavailable") return { kind: "unavailable", message: data.message };
  if (failure !== null) return { kind: "unavailable", message: `Couldn’t read Burn: ${failure}` };
  return { kind: "loading" };
}
