/** What of a Web Animation this needs: when it settles (never what it settles with), and stopping it. */
export type Played = { readonly finished: Promise<unknown>; cancel(): void };

export class Playing {
  private readonly running = new Set<Played>();
  private torn = false;

  /** Holds `animations` until each has finished or been stopped; then `landed` runs, unless the list is gone by then. */
  hold(animations: readonly Played[], landed: () => void): void {
    for (const a of animations) this.running.add(a);
    void Promise.allSettled(animations.map((a) => a.finished)).then(() => {
      for (const a of animations) this.running.delete(a);
      if (!this.torn) landed();
    });
  }

  /** Stops each where it is. Its `finished` rejects, so its plan lands as if it had played out. */
  stop(): void {
    for (const a of this.running) a.cancel();
  }

  /** The list is gone: everything stops, and nothing lands. */
  tearDown(): void {
    this.torn = true;
    this.stop();
  }
}
