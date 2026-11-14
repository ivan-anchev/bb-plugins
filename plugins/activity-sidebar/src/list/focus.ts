// Where keyboard focus goes when the row holding it leaves the list. Pure.

/**
 * The row that inherits focus from `gone`: the first row after it that is still listed, else the
 * nearest one before it, else null (nothing is left). `before` is the row order focus last saw.
 */
export function heirOf(before: readonly string[], gone: string, listed: ReadonlySet<string>): string | null {
  const at = before.indexOf(gone);
  const nearestFirst = [...before.slice(at + 1), ...before.slice(0, Math.max(0, at)).reverse()];
  return nearestFirst.find((key) => listed.has(key)) ?? null;
}
