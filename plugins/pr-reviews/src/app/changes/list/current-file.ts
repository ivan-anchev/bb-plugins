/**
 * `tops`: each file's offset in the list, in order, so ascending. `line`: the offset of the line the
 * reader is on. The index of the last file starting at or above it, or the first file above them all.
 */
export function fileIndexAt(tops: readonly number[], line: number): number {
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (tops[middle] <= line) low = middle;
    else high = middle - 1;
  }
  return low;
}
