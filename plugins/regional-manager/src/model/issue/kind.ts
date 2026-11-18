// An issue's kind, and the pipeline each kind runs: the one place the model says what happens to an
// issue after its agent hands off done. Everything that differs between kinds is read from
// PIPELINES through the functions below, so a kind's pipeline can't drift between issues and a new
// kind is a new row.
import { z } from "zod";

// why no CHECK in SQL: a new kind must not need a table rebuild. The store parses the column with this.
export const kindSchema = z.enum(["build"]);
export type Kind = z.infer<typeof kindSchema>;

/** A status a done handoff can wait in before Done. Each is left by its own evidence (status.ts STAGES). */
export type Stage = "verifying" | "in-review";

type Pipeline = {
  /** The kind as the board's row and crew_catch_up name it. */
  label: string;
  /** What its done handoff hands over (handoff.ts Delivery). */
  delivers: "commit";
  /** The statuses a done handoff passes through, in order, before Done. */
  stages: readonly Stage[];
};

export const PIPELINES: Record<Kind, Pipeline> = {
  // Ships code: verified, then waits on the user or its pull request, then Done when it merges.
  build: { label: "Build", delivers: "commit", stages: ["verifying", "in-review"] },
};

/** Whether a verifier judges the kind's done handoffs; it also makes done-criteria required before an agent starts. */
export const isVerified = (kind: Kind): boolean => PIPELINES[kind].stages.includes("verifying");

/** Whether the kind's done handoff names a commit: the plugin reads the agent's checkout as it hands off, and the PR watch reads its branch. */
export const shipsCode = (kind: Kind): boolean => PIPELINES[kind].delivers === "commit";

/** The fewest done-criteria an agent may start with. */
export const minCriteria = (kind: Kind): number => (isVerified(kind) ? 1 : 0);
