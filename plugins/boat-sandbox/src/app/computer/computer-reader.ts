import type { ComputerView } from "../../contract.ts";

/** What the page shows: the last view this reader read, and why the latest read failed, if it did. */
export interface ComputerReading {
  view: ComputerView | undefined;
  failure: string | null;
}

export const NOT_READ: ComputerReading = { view: undefined, failure: null };

/**
 * Reads now, then again after each answer while `pageShows`, handing every reading to `show`. One read
 * at a time, so a slow answer never lands over a newer one. Returns the function that stops it.
 */
export function readComputerEvery(read: () => Promise<ComputerView>, show: (reading: ComputerReading) => void, pageShows: () => boolean): () => void {
  let reading = NOT_READ;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readNow = async () => {
    if (pageShows()) {
      reading = await read().then(
        (view): ComputerReading => ({ view, failure: null }),
        (error: unknown): ComputerReading => ({ view: reading.view, failure: error instanceof Error ? error.message : String(error) }),
      );
      if (stopped) return;
      show(reading);
    }
    timer = setTimeout(readNow, readAgainIn(reading));
  };
  void readNow();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

const READ_AGAIN_MS: Record<ComputerView["status"], number> = {
  starting: 3_000,
  provisioning: 3_000,
  ready: 10_000,
  stopped: 5_000,
  unavailable: 15_000,
  "not-boat": 60_000,
};
const AFTER_FAILURE_MS = 10_000;

function readAgainIn({ view }: ComputerReading): number {
  return view === undefined ? AFTER_FAILURE_MS : (READ_AGAIN_MS[view.status] ?? AFTER_FAILURE_MS);
}
