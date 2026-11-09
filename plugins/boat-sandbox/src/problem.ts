/** Something that keeps boat Sandbox from working, and the one step that fixes it. */
export interface Problem {
  message: string;
  fix: string;
}

/**
 * bb reads the plugin's status only when the plugin loads (`bb.status.needsConfiguration`),
 * so every fix ends by reloading the plugin; otherwise bb keeps showing the stale problem.
 */
const RELOAD = "bb plugin reload boat-sandbox";

/** `step` is the fix itself, phrased as an imperative clause without a final period. */
export const problem = (message: string, step: string): Problem => ({
  message,
  fix: `${step}, then run \`${RELOAD}\`.`,
});

/** All problems as one paragraph, for bb's status line and provider messages. */
export const describeProblems = (problems: readonly Problem[]): string =>
  problems.map((problem) => `${problem.message} ${problem.fix}`).join(" ");

/** boat's and the start gate's messages are written for people, so they are shown as they are. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
