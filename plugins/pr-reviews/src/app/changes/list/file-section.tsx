// One file of the Changes tab's list: its card, whose body draws the diff once the reader nears it
// or jumps to it. Until then the body is blank and about as tall as the diff will be, so the
// scrollbar and a jump to a file further down hold still as the diffs above it draw.
import { memo, useContext, useEffect, useRef, useState, type RefObject } from "react";
import type { DiffFile } from "../../../diff/diff-schema.ts";
import type { DiffSettings } from "../../diff/diff-options.ts";
import type { PrHeadTarget } from "../../queries.ts";
import { FileCard } from "../../ui/file-card.tsx";
import { fileStatPartsOf } from "../change-stats.ts";
import { StatText } from "../stat-text.tsx";
import { ApproachContext } from "./approach.ts";
import { diffSourceOf } from "./diff-source.ts";
import { FileDiff } from "./file-diff.tsx";

/** A jump to a file's card: from its tree row, or to show one of its threads (`reveal`), which draws a folded diff too. */
export type Jump = { treePath: string; reveal: boolean };

/** `jump`: the latest jump, when it is to this file. */
type FileSectionProps = { file: DiffFile; head: PrHeadTarget; settings: DiffSettings; jump: Jump | null };

// Memoised: the list re-renders as the reader moves through it, and only a file whose props
// changed redraws.
export const FileSection = memo(function FileSection({ file, head, settings, jump }: FileSectionProps) {
  const section = useRef<HTMLDivElement>(null);
  const [near, setNear] = useNearing(section);
  const [unfolded, setUnfolded] = useState(false);
  const [jumped, setJumped] = useState<Jump | null>(null);
  // Set during render, so the diff draws in the render the jump arrives in.
  if (jump !== null && jump !== jumped) {
    setJumped(jump);
    setNear(true);
    if (jump.reveal) setUnfolded(true);
  }

  return (
    <div ref={section}>
      <FileCard path={file.path} end={<StatText parts={fileStatPartsOf(file)} />}>
        {near ? (
          <FileDiff file={file} head={head} settings={settings} unfolded={unfolded} onUnfold={() => setUnfolded(true)} />
        ) : (
          <div style={{ height: estimatedHeightOf(file) }} />
        )}
      </FileCard>
    </div>
  );
});

// A file stays drawn once drawn: scrolling back finds it as the reader left it, its expanded
// lines, selection and comment box included.
function useNearing(section: RefObject<HTMLDivElement | null>) {
  const watcher = useContext(ApproachContext)!;
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!near) return watcher.watch(section.current!, () => setNear(true));
  }, [watcher, section, near]);
  return [near, setNear] as const;
}

// What Pierre draws: a row a line at bb's 18px line height, a separator above each hunk, and a
// fold or a notice in one short row.
const ROW_HEIGHT = 18;
const SEPARATOR_HEIGHT = 32;
const NOTICE_HEIGHT = 48;

function estimatedHeightOf(file: DiffFile): number {
  const source = diffSourceOf(file);
  if (source.kind === "notice" || source.folded !== null) return NOTICE_HEIGHT;
  return file.hunks.reduce((height, hunk) => height + SEPARATOR_HEIGHT + hunk.lines.length * ROW_HEIGHT, 0);
}
