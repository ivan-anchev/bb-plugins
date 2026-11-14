// The Activity card's data: reads the server's snapshot and turns it into
// the six-month window of days and the totals caption.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { activityContract, type Activity } from "../contract.ts";
import { dailyTotals, gridStart, startOfDay } from "./days.ts";
import { ActivityCard } from "./ActivityCard.tsx";
import { plural } from "./format.ts";

export function Activity() {
  const query = experimental_useRpcQuery({ contract: activityContract, method: "activity", input: {} });
  const today = startOfDay(Date.now());
  const from = gridStart(today);
  const days = dailyTotals(query.data?.prs ?? [], from, today);

  return <ActivityCard days={days} today={today} caption={caption(query.data, query.error !== null, from)} />;
}

function caption(activity: Activity | undefined, failed: boolean, from: number): string {
  if (activity === undefined) return failed ? "Couldn’t load activity." : "Reading GitHub…";
  if (activity.prs === null) return activity.problem ?? "Reading GitHub…";
  const prs = activity.prs.filter((pr) => pr.mergedAt >= from);
  const threads = activity.threadStarts.filter((at) => at >= from).length;
  const lines = prs.reduce((sum, pr) => sum + pr.lines, 0);
  return [plural(threads, "thread"), `${plural(prs.length, "PR")} merged`, `${plural(lines, "line")} changed`].join(" · ");
}

