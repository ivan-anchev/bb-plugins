// One instance of the plugin, from load to dispose. bb reloads a plugin by disposing the instance
// and loading a new one over the same database and bb, and work the old one started (an issue's
// turn the tick doesn't wait for, a tool call) would go on calling bb and writing the database
// beside the new one's, from wherever it awaits. So what the plugin acts through, bb's SDK and its
// store, is handed out here bound to the instance: once it is disposed, every call through them
// throws, wherever the work is, and the issues' turns admit nothing more (issue-turns.ts). why not
// wait for that work in dispose: a call bb never answers would hold the reload forever.

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
    // why not a copy with its own sdk: the host's other members, its log among them, keep working after dispose, as they are.
    bb: new Proxy(host, { get: (target, key) => (key === "sdk" ? sdk : Reflect.get(target, key)) }),
    bind: (target) => bound(target, disposal.signal),
    signal: disposal.signal,
  };
}

/**
 * `target`, whose every function, its own or one reached through it, throws `signal`'s reason once
 * it aborts, before it runs. why every one reached: bb's SDK is a tree (`sdk.threads.queuedMessages.list`),
 * and a node of it can be both called and read. Called with `self` as `this`, the object it was read from.
 */
function bound<T extends object>(target: T, signal: AbortSignal, self: object | null = null): T {
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key);
      return (typeof value === "object" || typeof value === "function") && value !== null ? bound(value, signal, object) : value;
    },
    apply(callee, thisArg, args) {
      signal.throwIfAborted();
      // why the cast: a proxy is called, and runs this trap, only when its target is a function.
      return Reflect.apply(callee as (...args: unknown[]) => unknown, self ?? thisArg, args);
    },
  });
}
