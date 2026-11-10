// How the plugin draws a diff with bb's host-shared Pierre: the theme and chrome of bb's own diff,
// and the diff built from the PR's patch, with the file's text once it is read so the unchanged
// lines can expand.
import { useMemo } from "react";
import { experimental_useCodeTheme as useCodeTheme, type CodeOverflowMode, type DiffViewMode } from "@get-bb/plugin-sdk/app";
import { getSingularPatch, processFile, type FileDiffMetadata } from "@pierre/diffs";
import type { FileDiffOptions } from "@pierre/diffs/react";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { filePatchOf } from "../../diff/hunk-patch.ts";
import { oldContentOf } from "../../diff/old-content.ts";
import type { LineGestures } from "./use-line-selection.ts";

/** The reader's diff settings, which the Changes header edits. */
export type DiffSettings = { view: DiffViewMode; overflow: CodeOverflowMode };

export const DEFAULT_DIFF_SETTINGS: DiffSettings = { view: "unified", overflow: "scroll" };

/** bb's diff text size, set on the diff's element because Pierre reads it from CSS variables. */
export const DIFF_TEXT_CLASS = "[--diffs-font-size:12px] [--diffs-line-height:18px]";

/**
 * Pierre's options for a diff: bb's code theme and the chrome of bb's own diff, in the reader's
 * settings, with lines picked from the gutter (its numbers, and the "+" bb's own diff shows on the
 * hovered line) and reported to `gestures`.
 */
// why memoised: a new options object makes Pierre re-render every row, which on a large file
// drops a drag in progress. Only a theme or settings change makes a new one, so `gestures` must be
// stable.
// why the gesture's start, change and end, not onLineSelected: the diff's selection is controlled,
// and Pierre draws a controlled selection only once it is handed back, so the highlight follows a
// drag only when each step is. onLineSelected also fires again for every range handed back.
export function useDiffOptions<Annotation>(settings: DiffSettings, gestures: LineGestures): FileDiffOptions<Annotation, undefined> {
  const code = useCodeTheme();
  return useMemo(
    () => ({
      theme: code.name,
      themeType: code.mode,
      diffStyle: settings.view,
      overflow: settings.overflow,
      disableFileHeader: true,
      expansionLineCount: 30,
      lineHoverHighlight: "number",
      enableLineSelection: true,
      onLineSelectionStart: gestures.picking,
      onLineSelectionChange: gestures.picking,
      onLineSelectionEnd: gestures.picked,
      // why the built-in "+" and never `renderGutterUtility`: setting both of Pierre's gutter APIs
      // throws, which takes down the whole plugin page. Its click handler is what makes a press
      // and drag from the "+" select lines; it reports the same range as the gesture's end.
      enableGutterUtility: true,
      onGutterUtilityClick: gestures.picked,
      unsafeCSS: NOTE_ROWS,
    }),
    [code.name, code.mode, settings.view, settings.overflow, gestures],
  );
}

// The rows Pierre slots notes into, the box and findings, are on the page's background, as the
// prototype draws them. Pierre's own backdrop for them is a step off its code background, and in
// bb's dark theme it is the very colour of a finding's recessed card, which then has no edge.
// Pierre also tints a note's row, with its gutter, as part of a selection: only the code lines
// read as selected.
const NOTE_ROWS = "[data-line-annotation],[data-gutter-buffer=annotation]{--diffs-annotation-bg:var(--background);--diffs-computed-selected-line-bg:var(--diffs-computed-diff-line-bg)}";

/**
 * The file's diff for Pierre: its patch at first, then, once `newContent` is read, both whole
 * sides, which is what makes Pierre draw expand controls. An added or deleted file's patch is
 * already the whole file, and a guide hunk has no text to expand into: both pass null.
 */
// why processFile and never loadDiffFiles or hydratePartialDiff: bb renders in a shared worker
// pool that can't take a function option, and its build shim doesn't export hydratePartialDiff.
// why one name on both sides, a rename's too: with no `diff --git` line Pierre compares the two
// names, and two names make it a rename; the bare path, never git's a/ b/ prefixes.
export function fileDiffOf(file: DiffFile, newContent: string | null): FileDiffMetadata {
  const oldName = file.status === "added" ? "/dev/null" : file.path;
  const newName = file.status === "deleted" ? "/dev/null" : file.path;
  const patch = `--- ${headerNameOf(oldName)}\n+++ ${headerNameOf(newName)}\n${filePatchOf(file)}`;
  if (newContent === null) return getSingularPatch(patch);
  const parsed = processFile(patch, {
    oldFile: { name: oldName, contents: oldContentOf(file, newContent) },
    newFile: { name: newName, contents: newContent },
    throwOnError: true,
  });
  if (parsed === undefined) throw new Error(`Pierre found no file in the patch of ${file.path}`);
  return parsed;
}

// why the path quoted: Pierre trims a header's name and ends it at a tab or line break, so a raw
// path can lose a leading or trailing space, a BOM, or all after a tab. A quoted name it reads
// back exactly, once `"`, `\`, tabs and line breaks in it are escaped.
const QUOTED_ESCAPES: Record<string, string> = { '"': '\\"', "\\": "\\\\", "\t": "\\t", "\n": "\\n", "\r": "\\r" };

/** A side's name as a patch header writes it: a path quoted, `/dev/null` (no git path is absolute) bare. */
function headerNameOf(name: string): string {
  return name === "/dev/null" ? name : `"${name.replace(/["\\\t\n\r]/g, (char) => QUOTED_ESCAPES[char])}"`;
}
