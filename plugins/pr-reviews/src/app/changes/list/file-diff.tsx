import { useMemo } from "react";
import { NO_THREADS, placeThreads, type PlacedThreads } from "../../../comments/place-threads.ts";
import { diffRowsOf } from "../../../diff/diff-rows.ts";
import type { DiffFile } from "../../../diff/diff-schema.ts";
import type { DiffSettings } from "../../diff/diff-options.ts";
import { PrDiff, type LineNote } from "../../diff/pr-diff.tsx";
import { useComments, useFileContent, type PrHeadTarget } from "../../queries.ts";
import { Button } from "../../ui/button.tsx";
import { Notice } from "../../ui/notice.tsx";
import { ReadError } from "../../ui/read-error.tsx";
import { diffSourceOf } from "./diff-source.ts";

/** `unfolded`: whether a folded diff draws, once the reader asked for it (`onUnfold`). */
type FileDiffProps = { file: DiffFile; head: PrHeadTarget; settings: DiffSettings; unfolded: boolean; onUnfold(): void };

export function FileDiff({ file, head, ...shown }: FileDiffProps) {
  const comments = useComments({ projectId: head.projectId, number: head.number });
  const threads = useMemo(
    () => (comments.data === undefined ? NO_THREADS : placeThreads(comments.data.threads, file.path, head.headSha, diffRowsOf(file, null))),
    [comments.data, file, head.headSha],
  );
  return (
    <>
      <ReadError read={comments} what="the PR's comments" />
      <FileBody file={file} head={head} threads={threads} {...shown} />
    </>
  );
}

function FileBody({ file, head, settings, unfolded, onUnfold, threads }: FileDiffProps & { threads: PlacedThreads }) {
  const source = diffSourceOf(file);
  switch (source.kind) {
    case "notice":
      return (
        <>
          <Notice>{source.message}</Notice>
          <PrDiff file={file} head={head} newContent={null} settings={settings} notes={NO_NOTES} threads={threads} />
        </>
      );
    case "patch":
      return source.folded !== null && !unfolded ? (
        <Fold reason={source.folded} onUnfold={onUnfold} />
      ) : (
        <PatchDiff file={file} expandable={source.expandable} head={head} settings={settings} threads={threads} />
      );
    default:
      return source satisfies never;
  }
}

const NO_NOTES: readonly LineNote[] = [];

function Fold({ reason, onUnfold }: { reason: string; onUnfold(): void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-1.5 pr-1.5 pl-3">
      <p className="text-xs text-muted-foreground">{reason}</p>
      <Button variant="ghost" size="sm" onClick={onUnfold}>
        Load diff
      </Button>
    </div>
  );
}

type PatchDiffProps = Pick<FileDiffProps, "file" | "head" | "settings"> & { expandable: boolean; threads: PlacedThreads };

function PatchDiff({ file, expandable, head, settings, threads }: PatchDiffProps) {
  const content = useFileContent({ projectId: head.projectId, sha: head.headSha, path: file.path }, expandable);
  return (
    <>
      <ReadError read={content} what="this file's unchanged lines" />
      <PrDiff file={file} head={head} newContent={content.data?.content ?? null} settings={settings} notes={NO_NOTES} threads={threads} />
    </>
  );
}
