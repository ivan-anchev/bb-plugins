import { z } from "zod";
import type { Check, CheckOutcome } from "../contract.ts";

const checkStatusSchema = z.enum(["REQUESTED", "QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "COMPLETED"]).catch("PENDING");
const conclusionSchema = z.enum(["", "SUCCESS", "NEUTRAL", "SKIPPED", "FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]).catch("");
const stateSchema = z.enum(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]).catch("PENDING");

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

const urlSchema = z.string().nullish().transform((url) => url || null);

const knownCheckSchema = z.discriminatedUnion("__typename", [
  z.object({ __typename: z.literal("CheckRun"), name: z.string(), detailsUrl: urlSchema, status: checkStatusSchema, conclusion: conclusionSchema }),
  z.object({ __typename: z.literal("StatusContext"), context: z.string(), targetUrl: urlSchema, state: stateSchema }),
]);
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
