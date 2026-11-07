// A PR's CI checks as gh reports them (`statusCheckRollup`), and the one rule that counts them.
// The rollup mixes two GitHub types: a CheckRun (Actions and other apps) has a `status` and,
// once completed, a `conclusion`; a StatusContext (the older commit-status API) has a `state`.
// GitHub can add values and item kinds later. Anything this plugin does not know yet counts as
// pending, so it neither fails the page read nor counts as a pass or a failure.
import { z } from "zod";
import type { ChecksSummary } from "../contract.ts";

type Outcome = "passing" | "failing" | "pending";

const checkStatusSchema = z.enum(["REQUESTED", "QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "COMPLETED"]).catch("PENDING");
// gh reports a check run that has not completed with an empty conclusion.
const conclusionSchema = z.enum(["", "SUCCESS", "NEUTRAL", "SKIPPED", "FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]).catch("");
const stateSchema = z.enum(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]).catch("PENDING");

// Neutral and skipped runs do not block a merge, so they count as passing, as GitHub's merge box counts them.
const CONCLUSION_OUTCOME: Record<z.infer<typeof conclusionSchema>, Outcome> = {
  "": "pending",
  SUCCESS: "passing",
  NEUTRAL: "passing",
  SKIPPED: "passing",
  FAILURE: "failing",
  CANCELLED: "failing",
  TIMED_OUT: "failing",
  ACTION_REQUIRED: "failing",
  STARTUP_FAILURE: "failing",
  STALE: "failing",
};

const STATE_OUTCOME: Record<z.infer<typeof stateSchema>, Outcome> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
};

const knownCheckSchema = z.discriminatedUnion("__typename", [
  z.object({ __typename: z.literal("CheckRun"), status: checkStatusSchema, conclusion: conclusionSchema }),
  z.object({ __typename: z.literal("StatusContext"), state: stateSchema }),
]);
const unknownCheckSchema = z.object({ __typename: z.string() }).transform(() => ({ __typename: "Unknown" as const }));

export const statusCheckRollupSchema = z.array(z.union([knownCheckSchema, unknownCheckSchema]));
type StatusCheck = z.infer<typeof statusCheckRollupSchema>[number];

export function summarizeChecks(rollup: StatusCheck[]): ChecksSummary {
  const summary: ChecksSummary = { passing: 0, failing: 0, pending: 0 };
  for (const check of rollup) summary[outcomeOf(check)]++;
  return summary;
}

function outcomeOf(check: StatusCheck): Outcome {
  switch (check.__typename) {
    case "CheckRun":
      return check.status === "COMPLETED" ? CONCLUSION_OUTCOME[check.conclusion] : "pending";
    case "StatusContext":
      return STATE_OUTCOME[check.state];
    case "Unknown":
      return "pending";
  }
}
