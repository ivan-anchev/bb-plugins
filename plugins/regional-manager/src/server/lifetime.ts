type Host = { sdk: object; onDispose(hook: () => void): void };

/**
 * The instance of the plugin `host` loaded: `bb`, the host with its SDK bound to the instance;
 * `bind`, which binds anything else it acts through, such as its store; and `signal`, which aborts
 * as it is disposed.
 */
export function pluginInstance<Bb extends Host>(host: Bb): { bb: Bb; bind<T extends object>(target: T): T; signal: AbortSignal } {
  const disposal = new AbortController();
  host.onDispose(() => disposal.abort(new Error("Regional Manager was reloaded or disabled, so this instance calls bb and writes its database no more.")));
  const sdk = bound(host.sdk, disposal.signal);
  return {
    bb: new Proxy(host, { get: (target, key) => (key === "sdk" ? sdk : Reflect.get(target, key)) }),
    bind: (target) => bound(target, disposal.signal),
    signal: disposal.signal,
  };
}

function bound<T extends object>(target: T, signal: AbortSignal, self: object | null = null): T {
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key);
      return (typeof value === "object" || typeof value === "function") && value !== null ? bound(value, signal, object) : value;
    },
    apply(callee, thisArg, args) {
      signal.throwIfAborted();
      return Reflect.apply(callee as (...args: unknown[]) => unknown, self ?? thisArg, args);
    },
  });
}
