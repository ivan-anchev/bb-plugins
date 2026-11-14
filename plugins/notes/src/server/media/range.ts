// The part of a file a request's Range header asks for (RFC 9110 §14). A <video> needs it to seek.

/** `part`: bytes `start` to `end`, both included. */
type ByteRange = { kind: "whole" } | { kind: "part"; start: number; end: number } | { kind: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * `size`: the file's length in bytes. A missing, malformed or multi-range header asks for the whole
 * file: RFC 9110 lets a server ignore Range, and browsers send one range for media.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  const [, first, last] = SINGLE_RANGE.exec(header ?? "") ?? [];
  if (first === undefined || (first === "" && last === "")) return { kind: "whole" };
  if (first === "") return suffix(Number(last), size);
  const start = Number(first);
  if (last !== "" && Number(last) < start) return { kind: "whole" };
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "part", start, end: last === "" ? size - 1 : Math.min(Number(last), size - 1) };
}

/** `bytes=-n`: the last n bytes, or the whole file when it is shorter. */
function suffix(length: number, size: number): ByteRange {
  if (length === 0) return { kind: "unsatisfiable" };
  return { kind: "part", start: Math.max(size - length, 0), end: size - 1 };
}
