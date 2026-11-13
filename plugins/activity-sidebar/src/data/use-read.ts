// One abortable one-shot read, made again whenever its key changes and dropped when the reader goes.
import { useEffect, useState } from "react";

/**
 * The value `read` resolves for `key`; undefined while it reads, when it failed, or when `key` is null
 * (nothing to read). A value read for an earlier key is never returned for a later one.
 */
export function useRead<T>(key: string | null, read: (signal: AbortSignal) => Promise<T>): T | undefined {
  const [got, setGot] = useState<{ key: string; value: T } | null>(null);

  useEffect(() => {
    if (key === null) return;
    const abort = new AbortController();
    read(abort.signal).then(
      (value) => {
        if (!abort.signal.aborted) setGot({ key, value });
      },
      // why: a failed or aborted read leaves the reader on what it shows without one.
      () => {},
    );
    return () => abort.abort();
    // why: `read` is a fresh closure every render; the key alone says when to read again.
  }, [key]);

  return got !== null && got.key === key ? got.value : undefined;
}
