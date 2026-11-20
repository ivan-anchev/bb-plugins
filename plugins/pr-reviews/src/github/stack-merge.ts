// A PR in a GitHub stack (gh stack) can't merge through `gh pr merge`: GitHub takes it only through
// its asynchronous merge API, which merges the PR and every open PR below it into the stack's base
// in one all-or-nothing step, then answers a poll. The gh calls for the stack read and the merge,
// and what their answers mean. Pure.
// API: https://github.com/github/gh-stack/blob/main/docs/src/content/docs/reference/merge-api.md
import { z } from "zod";
import type { MergeMethod, MergeOutcome, PrStack } from "../contract.ts";
import type { Repo } from "./repo.ts";

/** Lists the stacks the PR is in: none, or the one it belongs to. */
export const stacksArgs = (repo: Repo, number: number): string[] => ["api", `repos/${repo}/stacks?pull_request=${number}`];

// Members bottom first, as the stack lists them.
const stacksSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    base: z.object({ ref: z.string() }),
    pull_requests: z.array(z.object({ number: z.number().int().positive(), state: z.enum(["open", "closed"]) })),
  }),
);

/** stacksArgs' answer as the stack PR `number` is in, or null when it is in none. */
export function parsePrStack(json: unknown, number: number): PrStack | null {
  const stack = stacksSchema.parse(json).find((candidate) => candidate.pull_requests.some((pr) => pr.number === number));
  if (stack === undefined) return null;
  const members = stack.pull_requests;
  const upTo = members.slice(0, members.findIndex((pr) => pr.number === number) + 1);
  return { number: stack.number, base: stack.base.ref, merges: upTo.filter((pr) => pr.state === "open").map((pr) => pr.number) };
}

// why sha: GitHub then refuses the merge once a push has moved the PR's head past the one the
// reader saw, as `gh pr merge --match-head-commit` does.
export const submitMergeArgs = (repo: Repo, number: number, method: MergeMethod, headSha: string): string[] => [
  "api",
  "--method",
  "PUT",
  `repos/${repo}/pulls/${number}/merge-async`,
  "-f",
  `merge_method=${method}`,
  "-f",
  `sha=${headSha}`,
];

export const pollMergeArgs = (repo: Repo, number: number, uuid: string): string[] => ["api", `repos/${repo}/pulls/${number}/merge-async/${uuid}`];

// The submit and the poll answer alike. A submit GitHub turns down (HTTP 400 "failed", or 409 for
// a merge already running, with that merge's uuid) still answers this way, on a failing gh's stdout.
const answerSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), details: z.object({ uuid: z.string() }) }),
  z.object({ status: z.literal("merged") }),
  z.object({ status: z.literal("enqueued") }),
  z.object({ status: z.literal("failed"), details: z.object({ message: z.string() }) }),
]);

/** Where a stack merge stands: still running on GitHub (poll `uuid`), done, or refused with GitHub's words. */
export type StackMergeAnswer = { kind: "pending"; uuid: string } | { kind: "done"; outcome: Exclude<MergeOutcome, "running"> } | { kind: "failed"; message: string };

/** A submit's or a poll's answer, or null for output that isn't one, such as a 404's. */
export function parseStackMergeAnswer(output: string): StackMergeAnswer | null {
  const answer = answerSchema.safeParse(parseJson(output));
  if (!answer.success) return null;
  switch (answer.data.status) {
    case "pending":
      return { kind: "pending", uuid: answer.data.details.uuid };
    case "merged":
      return { kind: "done", outcome: "merged" };
    case "enqueued":
      return { kind: "done", outcome: "queued" };
    case "failed":
      return { kind: "failed", message: answer.data.details.message };
  }
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}
