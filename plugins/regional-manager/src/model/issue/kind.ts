// An issue's kind, and the pipeline each kind runs: the one place the model says what happens to an
// issue after its agent hands off done. Everything that differs between kinds is read from
// PIPELINES through the functions below, so a kind's pipeline can't drift between issues and a new
// kind is a new row.
import { z } from "zod";

// why no CHECK in SQL: a new kind must not need a table rebuild. The store parses the column with this.
export const kindSchema = z.enum(["build", "research"]);
export type Kind = z.infer<typeof kindSchema>;

/** A status a done handoff can wait in before Done. Each is left by its own evidence (status.ts STAGES). */
export type Stage = "verifying" | "in-review";

/**
 * A kind's pipeline. why a union of paths rather than independent flags: a verifier judges a commit
 * and a pull request merges one, so only a path that delivers a commit may pass through a stage.
 */
type Pipeline = {
  /** The kind as the board's row and crew_catch_up name it. */
  label: string;
  /** The kinds its sub-issues may be (brief, open question 7). */
  holds: readonly Kind[];
} & (
  | {
      /** What its done handoff hands over (handoff.ts Delivery). */
      delivers: "commit";
      /** The statuses a done handoff passes through, in order, before Done. */
      stages: readonly Stage[];
    }
  | { delivers: "report"; stages: readonly [] }
);

export const PIPELINES: Record<Kind, Pipeline> = {
  // Ships code: verified, then waits on the user or its pull request, then Done when it merges.
  // why it holds research too: code work often starts from a question answered first.
  build: { label: "Build", holds: ["build", "research"], delivers: "commit", stages: ["verifying", "in-review"] },
  // A probe, spike, investigation or design: its report is the result, nobody judges it, and its done handoff is Done.
  // why only research under it: it closes with its last sub-issue, and code work under it would close it unmerged and unchecked.
  research: { label: "Research", holds: ["research"], delivers: "report", stages: [] },
};

/** Whether a verifier judges the kind's done handoffs; it also makes done-criteria required before an agent starts. */
export function isVerified(kind: Kind): boolean {
  const stages: readonly Stage[] = PIPELINES[kind].stages;
  return stages.includes("verifying");
}

/** Whether the kind's done handoff names a commit: the plugin reads the agent's checkout as it hands off, and the PR watch reads its branch. */
export const shipsCode = (kind: Kind): boolean => PIPELINES[kind].delivers === "commit";

/** The fewest done-criteria an agent may start with. */
export const minCriteria = (kind: Kind): number => (isVerified(kind) ? 1 : 0);
