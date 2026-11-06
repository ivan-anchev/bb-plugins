// A hunk as experimental_Diff input. Shared: the app renders each hunk of a step on its own.
import { hunkIdOf, type Hunk } from "./diff-schema.ts";

/** A headerless single-hunk patch; experimental_Diff completes it from its `path` prop. */
export function hunkToPatch(hunk: Hunk): string {
  return `${hunkIdOf(hunk)}\n${hunk.lines.join("\n")}\n`;
}
