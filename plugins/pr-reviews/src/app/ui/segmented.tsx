// A segmented control's look, drawn as bb's own Preview/Raw switch in its file preview is (a 6px
// track, 2px in, round 4px segments): a recessed track of equal-width segments, with a raised thumb
// that slides to the selected one. The comment box's Write/Preview tabs and its Send as radios
// share it; each sets its segments' height and the attribute that marks the selected one. Its
// colours and edge are app.css's `--pr-reviews-segment-*` tokens.

export const TRACK_CLASS = "relative grid grid-flow-col auto-cols-fr rounded-md bg-(--pr-reviews-segment-track) p-0.5";

export const SEGMENT_CLASS =
  "relative inline-flex cursor-pointer items-center justify-center rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none";

const THUMB_CLASS =
  "absolute inset-y-0.5 left-0.5 rounded-sm bg-(--pr-reviews-segment-thumb) shadow-(--pr-reviews-segment-thumb-ring) transition-transform duration-150 ease-out motion-reduce:transition-none";

/** The thumb under the `at`th of `of` segments: a segment's width, slid by its own width per step. */
export function SegmentThumb({ at, of }: { at: number; of: number }) {
  return <span aria-hidden className={THUMB_CLASS} style={{ width: `calc((100% - 4px) / ${of})`, transform: `translateX(${at * 100}%)` }} />;
}
