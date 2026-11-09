import assert from "node:assert/strict";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliRegistration,
  PluginSettingDescriptor,
  PluginSettingsHandle,
  PluginThreadEventHandler,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import type { AttentionEvent, GrokWakeHost, RoutesDescriptors, SecretPairDescriptors } from "./bb-types.ts";
import { routesSetting } from "./routes.ts";
import plugin from "./server.ts";
import { startReceiver, thread } from "./test-support.ts";

const URL_KEY = "GROK_WAKE_OPS_URL";
const KEY_KEY = "GROK_WAKE_OPS_KEY";
const receiver = await startReceiver();
after(() => receiver.close());

test("bb's plugin API is a GrokWakeHost", () => {
  const host: (bb: BbPluginApi) => GrokWakeHost = (bb) => bb;
  assert.equal(typeof host, "function");
});

test("it listens to the three attention signals only", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  assert.deepEqual(Object.keys(bb.current().handlers).sort(), ["interaction.pending", "thread.failed", "thread.idle"]);
});

test("each routed target gets a URL and a key secret field", async () => {
  const bb = await loadedWith({ sections: { sec_1: "ops" }, projects: { proj_1: "Dev", proj_2: "ops" } });
  const secretFields = [...bb.current().declared].filter(([, descriptor]) => descriptor.type === "string" && descriptor.secret);
  assert.deepEqual(secretFields.map(([name]) => name).sort(), [
    "GROK_WAKE_DEV_KEY",
    "GROK_WAKE_DEV_URL",
    "GROK_WAKE_OPS_KEY",
    "GROK_WAKE_OPS_URL",
  ]);
});

test("adding a target reloads the plugin so its fields appear", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  await bb.setRoutes({ projects: { proj_1: "ops", proj_2: "dev" } });
  assert.equal(bb.loads(), 2);
  assert.ok(bb.current().declared.has("GROK_WAKE_DEV_URL"));
});

test("removing a target unsets its secrets before the reload drops its fields", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev" } });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-gone" });
  await bb.setRoutes({ projects: { proj_2: "dev" } });
  assert.equal(bb.loads(), 2);
  assert.equal(bb.stored.has(URL_KEY), false);
  assert.equal(bb.stored.has(KEY_KEY), false);
  assert.equal(bb.current().declared.has(URL_KEY), false);
});

test("changing only which ids route where does not reload", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  await bb.setRoutes({ sections: { sec_9: "ops" } });
  assert.equal(bb.loads(), 1);
});

test("an attention event on a routed thread POSTs once", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  bb.set({ [URL_KEY]: receiver.url, [KEY_KEY]: "dummy-key-server" });
  const before = receiver.requests.length;
  await bb.fire("thread.idle", { thread: thread(), lastAssistantText: "Done." });
  assert.equal(receiver.requests.length, before + 1);
  assert.equal(JSON.parse(receiver.requests.at(-1)?.body ?? "{}").event, "finished");
});

test("test names the missing setting, never a value", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  const unset = await bb.cli(["test", "ops"]);
  assert.equal(unset.exitCode, 1);
  assert.match(unset.stderr ?? "", /OPS is missing GROK_WAKE_OPS_URL and GROK_WAKE_OPS_KEY/);

  bb.set({ [URL_KEY]: "http://127.0.0.1:9/secret-path" });
  const halfSet = await bb.cli(["test", "ops", "--json"]);
  const output = `${halfSet.stdout}${halfSet.stderr}`;
  assert.match(output, /missing GROK_WAKE_OPS_KEY\./);
  assert.ok(!output.includes("secret-path"));
});

test("test rejects a target no route sends to", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  const result = await bb.cli(["test", "dev"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr ?? "", /No route sends to DEV/);
});

test("test prints only the status, and a failed test is not logged", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  bb.set({ [URL_KEY]: receiver.url, [KEY_KEY]: "dummy-key-cli" });
  receiver.state.status = 202;
  assert.deepEqual(await bb.cli(["test", "ops"]), { exitCode: 0, stdout: "HTTP 202\n" });
  assert.equal(JSON.parse(receiver.requests.at(-1)?.body ?? "{}").event, "test");

  receiver.state.status = 500;
  assert.deepEqual(await bb.cli(["test", "ops", "--json"]), { exitCode: 1, stdout: '{"ok":false,"reason":"http 500"}\n' });
  assert.deepEqual(await bb.cli(["failures", "--json"]), { exitCode: 0, stdout: '{"total":0,"failures":[]}\n' });
  receiver.state.status = 200;
});

test("a failed event is listed, then drained once the receiver recovers", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  bb.set({ [URL_KEY]: receiver.url, [KEY_KEY]: "dummy-key-drain" });
  receiver.state.status = 500;
  await bb.fire("thread.failed", { thread: thread(), error: "Provider rejected request" });

  const listed = await bb.cli(["failures"]);
  assert.match(listed.stdout ?? "", /OPS {2}failed {2}thr_abcdefgh123 {2}Fix the build {2}http 500/);
  assert.equal((await bb.cli(["drain"])).stdout, "Delivered 0, kept 1.\n");

  receiver.state.status = 200;
  assert.equal((await bb.cli(["drain", "--json"])).stdout, '{"delivered":1,"kept":0}\n');
  assert.equal((await bb.cli(["failures"])).stdout, "No undelivered events.\n");
});

test("a target added then another removed before the sync runs: the removed one's secrets go", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev" } });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-rapid" });
  void bb.writeRoutes({ projects: { proj_1: "ops", proj_2: "dev", proj_3: "new" } });
  await bb.setRoutes({ projects: { proj_2: "dev", proj_3: "new" } });

  assert.equal(bb.loads(), 2);
  assert.equal(bb.stored.has(URL_KEY), false);
  assert.equal(bb.stored.has(KEY_KEY), false);
  assert.deepEqual(secretFieldsOf(bb), ["GROK_WAKE_DEV_KEY", "GROK_WAKE_DEV_URL", "GROK_WAKE_NEW_KEY", "GROK_WAKE_NEW_URL"]);
});

test("a target removed then restored before the sync runs keeps its secrets", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev" } });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-restored" });
  void bb.writeRoutes({ projects: { proj_2: "dev" } });
  await bb.setRoutes({ projects: { proj_1: "ops", proj_2: "dev" } });

  assert.equal(bb.loads(), 1);
  assert.equal(bb.stored.get(KEY_KEY), "dummy-key-restored");
});

test("after a failed unset, the next routes change still syncs", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev" } });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-retry" });
  bb.faults.secretWrites = 1;
  await bb.setRoutes({ projects: { proj_2: "dev" } });
  assert.equal(bb.loads(), 1);
  assert.match(bb.errors.join("\n"), /could not apply the routes change: secret write failed/);

  await bb.setRoutes({ projects: { proj_2: "dev", proj_3: "new" } });
  assert.equal(bb.loads(), 2);
  assert.equal(bb.stored.has(KEY_KEY), false);
  assert.deepEqual(secretFieldsOf(bb), ["GROK_WAKE_DEV_KEY", "GROK_WAKE_DEV_URL", "GROK_WAKE_NEW_KEY", "GROK_WAKE_NEW_URL"]);
});

test("after a failed reload, the next routes change still reloads", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  bb.faults.reloads = 1;
  await bb.setRoutes({ projects: { proj_1: "ops", proj_2: "dev" } });
  assert.equal(bb.loads(), 1);
  assert.match(bb.errors.join("\n"), /could not apply the routes change: reload failed/);

  await bb.setRoutes({ sections: { sec_1: "dev" }, projects: { proj_1: "ops", proj_2: "dev" } });
  assert.equal(bb.loads(), 2);
  assert.ok(bb.current().declared.has("GROK_WAKE_DEV_URL"));
});

test("unloading cancels a sync that has not run yet", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev" } });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-unloaded" });
  await bb.writeRoutes({ projects: { proj_2: "dev" } });
  await bb.dispose();
  await settle();

  assert.equal(bb.loads(), 1);
  assert.equal(bb.stored.get(KEY_KEY), "dummy-key-unloaded");
});

test("unloading stops an in-flight wake, which stays in the failure log as cancelled", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  bb.set({ [URL_KEY]: receiver.url, [KEY_KEY]: "dummy-key-unload" });
  receiver.state.hang = true;
  try {
    const wake = bb.fire("thread.idle", { thread: thread({ updatedAt: 900 }), lastAssistantText: "Done." });
    await settle();
    const started = Date.now();
    await bb.dispose();
    await wake;
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(bb.failureReasons(), ["cancelled"]);
  } finally {
    receiver.state.hang = false;
  }
});

test("a drain whose caller goes away stops promptly and keeps the entry as it was", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  bb.set({ [URL_KEY]: receiver.url, [KEY_KEY]: "dummy-key-hangup" });
  receiver.state.status = 500;
  await bb.fire("thread.failed", { thread: thread(), error: "Provider rejected request" });
  receiver.state.status = 200;
  receiver.state.hang = true;
  try {
    const caller = new AbortController();
    const drained = bb.cli(["drain", "--json"], { signal: caller.signal });
    await settle();
    const started = Date.now();
    caller.abort();
    assert.deepEqual(await drained, { exitCode: 0, stdout: '{"delivered":0,"kept":0}\n' });
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(bb.failureReasons(), ["http 500"]);
  } finally {
    receiver.state.hang = false;
  }
});

test("a target restored while an earlier target's unset is pending keeps its secrets", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev" } });
  bb.set({ GROK_WAKE_DEV_URL: "http://127.0.0.1:9/dev", GROK_WAKE_DEV_KEY: "dummy-key-dev" });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-restored-later" });
  const unsetDev = bb.hold("secretWrite");
  await bb.writeRoutes({});
  await unsetDev.reached;
  await bb.writeRoutes({ projects: { proj_1: "ops" } });
  unsetDev.release();
  await settle();

  assert.equal(bb.stored.has("GROK_WAKE_DEV_KEY"), false);
  assert.equal(bb.stored.get(KEY_KEY), "dummy-key-restored-later");
  assert.equal(bb.loads(), 2);
  assert.deepEqual(secretFieldsOf(bb), [KEY_KEY, URL_KEY]);
});

test("unloading while the sync reads routes stops it before any unset or reload", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev" } });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-read" });
  const read = bb.hold("routesRead");
  await bb.writeRoutes({ projects: { proj_2: "dev", proj_3: "new" } });
  await read.reached;
  await bb.dispose();
  read.release();
  await settle();

  assert.equal(bb.loads(), 1);
  assert.equal(bb.stored.get(KEY_KEY), "dummy-key-read");
});

test("unloading during one unset leaves the other dropped targets' secrets alone", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops", proj_2: "dev", proj_3: "keep" } });
  bb.set({ GROK_WAKE_DEV_URL: "http://127.0.0.1:9/dev", GROK_WAKE_DEV_KEY: "dummy-key-dev" });
  bb.set({ [URL_KEY]: "http://127.0.0.1:9/hook", [KEY_KEY]: "dummy-key-untouched" });
  const unsetDev = bb.hold("secretWrite");
  await bb.writeRoutes({ projects: { proj_3: "keep" } });
  await unsetDev.reached;
  await bb.dispose();
  unsetDev.release();
  await settle();

  assert.equal(bb.stored.has("GROK_WAKE_DEV_KEY"), false);
  assert.equal(bb.stored.get(KEY_KEY), "dummy-key-untouched");
  assert.equal(bb.loads(), 1);
});

test("a drain cancelled before it starts leaves every entry's reason as it was", async () => {
  const bb = await loadedWith({ projects: { proj_1: "ops" } });
  bb.set({ [URL_KEY]: receiver.url, [KEY_KEY]: "dummy-key-precancelled" });
  receiver.state.status = 500;
  await bb.fire("thread.failed", { thread: thread({ updatedAt: 100 }), error: "First" });
  await bb.fire("thread.failed", { thread: thread({ updatedAt: 200 }), error: "Second" });
  receiver.state.status = 200;
  bb.stored.delete(URL_KEY);
  bb.stored.delete(KEY_KEY);

  const caller = new AbortController();
  caller.abort();
  assert.deepEqual(await bb.cli(["drain", "--json"], { signal: caller.signal }), {
    exitCode: 0,
    stdout: '{"delivered":0,"kept":0}\n',
  });
  assert.deepEqual(bb.failureReasons(), ["http 500", "http 500"]);
});

/** Lets deferred settings syncs and in-flight requests run. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function secretFieldsOf(bb: LoadedPlugin): string[] {
  return [...bb.current().declared].filter(([, descriptor]) => descriptor.type === "string" && descriptor.secret).map(([name]) => name).sort();
}

type LoadedPlugin = Awaited<ReturnType<typeof loadedWith>>;

/** A host step a test can pause: the next call waits there until released. */
type HeldStep = "routesRead" | "secretWrite";

interface Hold {
  /** Resolves once a call has reached the step and is waiting. */
  reached: Promise<void>;
  release(): void;
}

type EventHandlers = { [E in AttentionEvent]?: PluginThreadEventHandler<E> };
type Registration = { [E in AttentionEvent]: [event: E, handler: PluginThreadEventHandler<E>] }[AttentionEvent];

/**
 * Loads the plugin against a fake host that keeps stored settings across
 * reloads, the way bb does: `plugins.reload` loads a new instance, then runs
 * the old one's dispose hooks and drops its settings listeners.
 */
async function loadedWith(routes: object) {
  const stored = new Map<string, string>([["routes", JSON.stringify(routes)]]);
  const db = new Database(":memory:");
  const faults = { secretWrites: 0, reloads: 0 };
  const holds = new Map<HeldStep, () => Promise<void>>();
  const errors: string[] = [];
  let instance = await load();
  let loads = 1;

  async function load() {
    const declared = new Map<string, PluginSettingDescriptor>();
    const handlers: EventHandlers = {};
    const listeners: Array<() => void> = [];
    const disposeHooks: Array<() => void | Promise<void>> = [];
    let routesHandle: PluginSettingsHandle<RoutesDescriptors> | undefined;
    let cli: PluginCliRegistration | undefined;

    function define(descriptors: RoutesDescriptors): PluginSettingsHandle<RoutesDescriptors>;
    function define(descriptors: SecretPairDescriptors): PluginSettingsHandle<SecretPairDescriptors>;
    function define(descriptors: RoutesDescriptors | SecretPairDescriptors) {
      for (const [name, descriptor] of Object.entries(descriptors)) declared.set(name, descriptor);
      if (isRoutes(descriptors)) {
        routesHandle = fakeHandle(() => ({ routes: stored.get("routes") ?? routesSetting.routes.default }), {
          beforeRead: () => pass("routesRead"),
          beforeWrite: async () => {},
        });
        return routesHandle;
      }
      const names = Object.keys(descriptors);
      return fakeHandle(() => Object.fromEntries(names.map((name) => [name, stored.get(name)])), {
        beforeRead: async () => {},
        async beforeWrite() {
          await pass("secretWrite");
          if (faults.secretWrites === 0) return;
          faults.secretWrites -= 1;
          throw new Error("secret write failed");
        },
      });
    }

    /** Like bb, a write through any handle notifies every listener of this load. */
    function fakeHandle<Values>(read: () => Values, steps: { beforeRead(): Promise<void>; beforeWrite(): Promise<void> }) {
      return {
        async get() {
          await steps.beforeRead();
          return read();
        },
        async experimental_set(values: Partial<Record<string, string | null>>) {
          await steps.beforeWrite();
          for (const [name, value] of Object.entries(values)) {
            if (value === null || value === undefined) stored.delete(name);
            else stored.set(name, value);
          }
          for (const notify of [...listeners]) notify();
          return read();
        },
        onChange: (listener: (next: Values, prev: Values) => void) => void listeners.push(() => listener(read(), read())),
      };
    }

    const host: GrokWakeHost = {
      pluginId: "grok-wake",
      log: { debug() {}, info() {}, warn() {}, error: (message) => void errors.push(message) },
      settings: { define },
      storage: {
        database: () => db,
        migrate: (target, statements) => statements.forEach((sql) => target.exec(sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"))),
      },
      events: {
        on(...[event, handler]: Registration) {
          switch (event) {
            case "interaction.pending":
              handlers[event] = handler;
              break;
            case "thread.idle":
              handlers[event] = handler;
              break;
            case "thread.failed":
              handlers[event] = handler;
              break;
            default:
              assert.fail(`the fake host does not handle ${event satisfies never}`);
          }
        },
      },
      cli: { register: (registration) => void (cli = registration) },
      onDispose: (hook) => void disposeHooks.push(hook),
      sdk: {
        threads: { interactions: { list: async () => [] } },
        plugins: {
          async reload() {
            if (faults.reloads > 0) {
              faults.reloads -= 1;
              throw new Error("reload failed");
            }
            const old = instance;
            instance = await load();
            loads += 1;
            await old.dispose();
            return { ok: true, plugins: [] };
          },
        },
      },
    };
    await plugin(host);
    assert.ok(cli);
    assert.ok(routesHandle);
    return {
      declared,
      handlers,
      cli,
      routesHandle,
      async dispose() {
        listeners.length = 0;
        for (const hook of disposeHooks.reverse()) await hook();
      },
    };
  }

  /** Waits at `step` when a test holds it; each hold pauses one call. */
  async function pass(step: HeldStep) {
    const wait = holds.get(step);
    holds.delete(step);
    await wait?.();
  }

  return {
    stored,
    faults,
    errors,
    loads: () => loads,
    hold(step: HeldStep): Hold {
      let arrive = () => {};
      let release = () => {};
      const reached = new Promise<void>((resolve) => (arrive = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      holds.set(step, async () => {
        arrive();
        await released;
      });
      return { reached, release };
    },
    current: () => instance,
    dispose: () => instance.dispose(),
    set(values: Record<string, string>) {
      for (const [name, value] of Object.entries(values)) stored.set(name, value);
    },
    /** Saves `routes` the way the Settings page does, without waiting for the sync it starts. */
    writeRoutes: (next: object) => instance.routesHandle.experimental_set({ routes: JSON.stringify(next) }),
    async setRoutes(next: object) {
      await instance.routesHandle.experimental_set({ routes: JSON.stringify(next) });
      await settle();
    },
    async fire<E extends AttentionEvent>(name: E, payload: PluginThreadEventPayloads[E]) {
      await instance.handlers[name]?.(payload);
    },
    cli: (argv: string[], ctx: PluginCliContext = {}) => instance.cli.run(argv, ctx),
    failureReasons: () => db.prepare("SELECT reason FROM failures").pluck().all(),
  };
}

function isRoutes(descriptors: RoutesDescriptors | SecretPairDescriptors): descriptors is RoutesDescriptors {
  return descriptors === routesSetting;
}
