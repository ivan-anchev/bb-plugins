import { useCallback, useState } from "react";

export function useRememberedState<Value>(memory: Map<string, Value>, key: string, initial: Value) {
  const [value, setValue] = useState(() => memory.get(key) ?? initial);
  const remember = useCallback(
    (next: Value) => {
      memory.set(key, next);
      setValue(next);
    },
    [memory, key],
  );
  return [value, remember] as const;
}
