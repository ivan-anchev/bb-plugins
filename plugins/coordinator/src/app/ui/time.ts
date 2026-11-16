/** A moment as the board shows it: today's as a time, an older one with its date. */
export function shortTime(at: number): string {
  const date = new Date(at);
  const today = date.toDateString() === new Date().toDateString();
  return date.toLocaleString([], today ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" });
}
