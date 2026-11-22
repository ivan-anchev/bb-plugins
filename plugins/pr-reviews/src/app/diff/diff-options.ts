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
      enableGutterUtility: true,
      onGutterUtilityClick: gestures.picked,
      unsafeCSS: `${NOTE_ROWS}${FULL_WIDTH_NOTES}${CODE_UNDER_HEADER}${NO_UPRIGHT_GUTTER}`,
    }),
    [code.name, code.mode, settings.view, settings.overflow, gestures],
  );
}

const NOTE_ROWS = "[data-line-annotation],[data-gutter-buffer=annotation]{--diffs-computed-selected-line-bg:var(--diffs-computed-diff-line-bg)}";

const FULL_WIDTH_NOTES =
  "[data-line-annotation]{z-index:4}" +
  "[data-annotation-content]{margin-left:calc(-1 * var(--diffs-column-number-width,0px))}" +
  "[data-overflow=scroll] [data-annotation-content]{left:0;width:calc(var(--diffs-column-content-width,100%) + var(--diffs-column-number-width,0px))}";

const CODE_UNDER_HEADER =
  "[data-code],[data-diff][data-overflow=wrap],[data-diff][data-dehydrated][data-diff-type=split][data-overflow=scroll]{padding-top:0}";

const NO_UPRIGHT_GUTTER = "[data-code]{scrollbar-gutter:auto}";

export function fileDiffOf(file: DiffFile, newContent: string | null): FileDiffMetadata {
  const patch = patchOf(file);
  if (newContent === null) return { ...getSingularPatch(patch), name: file.path };
  const parsed = processFile(patch, {
    oldFile: { name: file.path, contents: oldContentOf(file, newContent) },
    newFile: { name: file.path, contents: newContent },
    throwOnError: true,
  });
  if (parsed === undefined) throw new Error(`Pierre found no file in the patch of ${file.path}`);
  return { ...parsed, name: file.path };
}

function patchOf(file: DiffFile): string {
  const oldName = file.status === "added" ? "/dev/null" : SIDE_NAME;
  const newName = file.status === "deleted" ? "/dev/null" : SIDE_NAME;
  return `--- ${oldName}\n+++ ${newName}\n${filePatchOf(file)}`;
}

const SIDE_NAME = "file";
