// A PR's CI checks as gh reports them (`statusCheckRollup`), and the one rule that gives each its
// outcome. The rollup mixes two GitHub types: a CheckRun (Actions and other apps) has a `name`, a
// `status` and, once completed, a `conclusion`; a StatusContext (the older commit-status API) has a
// `context` and a `state`. GitHub can add values and item kinds later. Anything this plugin does not
// know yet is pending, so it neither fails the page read nor counts as a pass or a failure.
import { z } from "zod";
import type { Check, CheckOutcome } from "../contract.ts";

const checkStatusSchema = z.enum(["REQUESTED", "QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "COMPLETED"]).catch("PENDING");
// gh reports a check run that has not completed with an empty conclusion.
const conclusionSchema = z.enum(["", "SUCCESS", "NEUTRAL", "SKIPPED", "FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]).catch("");
const stateSchema = z.enum(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]).catch("PENDING");

// Neutral and skipped runs do not block a merge, so they count as passing, as GitHub's merge box counts them.
const CONCLUSION_OUTCOME: Record<z.infer<typeof conclusionSchema>, CheckOutcome> = {
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

const STATE_OUTCOME: Record<z.infer<typeof stateSchema>, CheckOutcome> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
};

// gh prints a missing details page as null or an empty string.
const urlSchema = z.string().nullish().transform((url) => url || null);

const knownCheckSchema = z.discriminatedUnion("__typename", [
  z.object({ __typename: z.literal("CheckRun"), name: z.string(), detailsUrl: urlSchema, status: checkStatusSchema, conclusion: conclusionSchema }),
  z.object({ __typename: z.literal("StatusContext"), context: z.string(), targetUrl: urlSchema, state: stateSchema }),
]);
// An item kind GitHub adds later is named by its kind, so the list still accounts for it.
const unknownCheckSchema = z.object({ __typename: z.string() }).transform(({ __typename }) => ({ __typename: "Unknown" as const, kind: __typename }));

/** The rollup, parsed into the canonical checks in GitHub's order. */
export const statusCheckRollupSchema = z.array(z.union([knownCheckSchema, unknownCheckSchema])).transform((rollup) => rollup.map(toCheck));
type StatusCheck = z.infer<typeof knownCheckSchema> | z.output<typeof unknownCheckSchema>;

function toCheck(check: StatusCheck): Check {
  switch (check.__typename) {
    case "CheckRun":
      return { name: check.name, url: check.detailsUrl, outcome: check.status === "COMPLETED" ? CONCLUSION_OUTCOME[check.conclusion] : "pending" };
    case "StatusContext":
      return { name: check.context, url: check.targetUrl, outcome: STATE_OUTCOME[check.state] };
    case "Unknown":
      return { name: check.kind, url: null, outcome: "pending" };
  }
}
