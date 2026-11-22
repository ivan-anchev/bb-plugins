import { useMemo } from "react";
import { experimental_useCodeTheme as useCodeTheme } from "@get-bb/plugin-sdk/app";
import { FileDiff } from "@pierre/diffs/react";
import type { DiffFile, Hunk, NumberedLine } from "../../diff/diff-schema.ts";
import { DIFF_TEXT_CLASS, fileDiffOf } from "../diff/diff-options.ts";

type OutdatedCodeProps = { path: string; excerpt: NumberedLine[] };

export function OutdatedCode({ path, excerpt }: OutdatedCodeProps) {
  const code = useCodeTheme();
  const fileDiff = useMemo(() => fileDiffOf(excerptFileOf(path, excerpt), null), [path, excerpt]);
  const options = useMemo(
    () => ({ theme: code.name, themeType: code.mode, diffStyle: "unified" as const, overflow: "scroll" as const, disableFileHeader: true, hunkSeparators: "simple" as const }),
    [code.name, code.mode],
  );
  return (
    <div role="region" aria-label="Code the thread was written on" tabIndex={0} className="outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <FileDiff className={`${DIFF_TEXT_CLASS} [--diffs-gap-block:0px]`} fileDiff={fileDiff} options={options} />
    </div>
  );
}

function excerptFileOf(path: string, excerpt: NumberedLine[]): DiffFile {
  return { path, previousPath: null, status: "modified", binary: false, hunks: [hunkOf(excerpt)] };
}

function hunkOf(excerpt: NumberedLine[]): Hunk {
  return {
    oldStart: excerpt.find((line) => line.old !== null)?.old ?? 0,
    oldLines: excerpt.filter((line) => line.text[0] !== "+").length,
    newStart: excerpt.find((line) => line.new !== null)?.new ?? 0,
    newLines: excerpt.filter((line) => line.text[0] !== "-").length,
    lines: excerpt.map((line) => line.text),
  };
}
