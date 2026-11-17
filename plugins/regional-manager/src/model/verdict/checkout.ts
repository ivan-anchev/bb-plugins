// The plugin's own check of a done handoff, before any criterion: that the agent's environment had
// the claimed commit checked out on a clean working tree. bb's git plugin reads it on the
// environment's machine as the agent hands off. why not the verifier's shell: a provider can run
// each command in a sandbox of its own, which shows files that aren't in the agent's tree (Claude
// Code's showed a boat sandbox's home dotfiles as untracked), and so fails clean work.
import { z } from "zod";

/** How many changed files a checkout lists by path; the rest are counted. */
const MAX_LISTED = 20;

/**
 * The agent's environment as bb's git plugin read it when the agent handed off: the commit checked
 * out, and its working tree's changed files, each as `<status> <path>` (`?? notes.txt`), listed up
 * to MAX_LISTED, with how many there were.
 */
export const checkoutSchema = z.object({
  headSha: z.string().min(1),
  changedFiles: z.array(z.string()).max(MAX_LISTED),
  changedFileCount: z.number().int().min(0),
});
export type Checkout = z.infer<typeof checkoutSchema>;

/** What a handoff's read of its environment came to: its checkout, or why bb's git plugin couldn't say. */
export type CheckoutRead = { kind: "read"; checkout: Checkout } | { kind: "unread"; reason: string };

/** The checkout from bb's read, its changed files listed up to the bound. */
export function checkoutOf(headSha: string, changedFiles: readonly { path: string; status: string }[], changedFileCount: number): Checkout {
  return { headSha, changedFiles: changedFiles.slice(0, MAX_LISTED).map(({ path, status }) => `${status} ${path}`), changedFileCount };
}

/** What keeps the checkout from being the claimed commit on a clean tree, one line each; none when it is. */
export function checkoutProblems(claimed: string, checkout: Checkout): string[] {
  const { headSha, changedFiles, changedFileCount } = checkout;
  const otherCommit = headSha === claimed ? [] : [`HEAD was ${headSha}, not the claimed ${claimed}`];
  if (changedFileCount === 0) return otherCommit;
  const more = changedFileCount - changedFiles.length;
  const listed = `${changedFiles.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
  return [...otherCommit, `the working tree had ${changedFileCount === 1 ? "1 changed file" : `${changedFileCount} changed files`}: ${listed}`];
}

/** Why a checkout the plugin read fails a verdict, whatever its criteria say: the board's headline, the verdict's lead. */
export const NOT_CLEAN = "Not the claimed commit on a clean tree";

/** The checkout in a sentence, as the plugin's: what the verifier is told, and what the verdict shows. */
export function checkoutText(claimed: string, checkout: Checkout): string {
  const problems = checkoutProblems(claimed, checkout);
  const read = "bb's git plugin read the agent's environment as it handed off";
  return problems.length === 0 ? `${read}: the claimed commit ${claimed} checked out, on a clean working tree.` : `${read}: ${problems.join("; ")}.`;
}
