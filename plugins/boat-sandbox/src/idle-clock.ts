import type { PluginKvStorage } from "@get-bb/plugin-sdk";

export interface IdleClock {
  /** Records that the machine did work now. */
  touch(hostId: string): Promise<void>;
  /** When the machine last did work; null when nothing was ever recorded. */
  read(hostId: string): Promise<number | null>;
  forget(hostId: string): Promise<void>;
}

export function createIdleClock(kv: PluginKvStorage): IdleClock {
  const key = (hostId: string) => `idle/${hostId}`;
  return {
    touch: (hostId) => kv.set(key(hostId), Date.now()),
    read: async (hostId) => (await kv.get<number>(key(hostId))) ?? null,
    forget: (hostId) => kv.delete(key(hostId)),
  };
}
