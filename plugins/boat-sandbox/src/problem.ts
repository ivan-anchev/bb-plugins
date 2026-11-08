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
