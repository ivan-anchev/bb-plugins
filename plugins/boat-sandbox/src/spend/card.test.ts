import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { createBoatAccess } from "../boat/access.ts";
import { machineLabels } from "../ownership.ts";
import type { SpendCardReply } from "../contract.ts";
import type { BoatSettingsValues } from "../settings.ts";
import { createSpendCard } from "./card.ts";

const CAPTURED = JSON.parse(readFileSync(new URL("../boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;
const OWNER = "owner-1";
const SETTINGS: BoatSettingsValues = { apiKey: "boat_abc", idleMinutes: 15, defaultPreset: "default", defaultTemplate: "", defaultEnvironment: "", sidebarIcon: true };
const ME = { user: { id: "sandbox_1", login: "octocat", zeroDataRetention: false, connectionMethods: ["github"] } };
// Shaped like the live account's /limits on 2026-11-14.
const LIMITS = {
  canStart: true,
  starts: { unlimited: true },
  wallet: { balanceDollars: 0 },
  planIncluded: { vmHours: 555.56, vmHoursRemaining: 500, periodEnd: "2026-12-08T17:35:29.000Z" },
  overagePrices: { vmHourDollars: 0.036 },
};

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

/** One sandbox of `GET /sandboxes?include=cost`. */
const metered = (id: string, state: string, type: string, billingMultiplier: number, dollars: number, labels: object) => ({
  ...CAPTURED,
  id,
  state,
  type,
  labels,
  billingMultiplier,
  cost: { since: "2026-11-01T00:00:00.000Z", seconds: 0, dollars },
});

/** boat answering /me, /limits and two pages of metered sandboxes. */
function boatWith(pages: { sandboxes: object[]; deleted: number }[]) {
  let page = 0;
  mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/me")) return Response.json(ME);
    if (url.endsWith("/limits")) return Response.json(LIMITS);
    const { sandboxes, deleted } = pages[page % pages.length]!;
    page += 1;
    const nextCursor = page % pages.length === 0 ? null : `page-${page}`;
    return Response.json({ sandboxes, pageInfo: { nextCursor }, deletedCost: { since: "2026-11-01T00:00:00.000Z", seconds: 0, dollars: deleted } });
  });
}

/**
 * boat answering as `account()`, its meter reading the next of `meters` per request, in the order they
 * arrive, for the month starting `since()`.
 */
function boatMetering(
  meters: (number | Promise<number>)[],
  { account = () => ME.user.id, since = () => "2026-11-01T00:00:00.000Z" }: { account?: () => string; since?: () => string } = {},
) {
  let next = 0;
  mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/me")) return Response.json({ user: { ...ME.user, id: account() } });
    if (url.endsWith("/limits")) return Response.json(LIMITS);
    const dollars = await meters[next++]!;
    return Response.json({ sandboxes: [], pageInfo: { nextCursor: null }, deletedCost: { since: since(), seconds: 0, dollars } });
  });
}

/** Mid-month, so a first reading only sets the baseline. */
const midMonth = () => mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-14T12:00:00Z") });

const today = (reply: SpendCardReply): number | null => (reply.status === "ready" ? (reply.days.at(-1)?.dollars ?? null) : null);

const signal = () => AbortSignal.timeout(10_000);

function memoryKv(): PluginKvStorage {
  const rows = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => rows.get(key) as T | undefined, // why: a fake of bb's untyped JSON store
    set: async (key, value) => void rows.set(key, structuredClone(value)),
    delete: async (key) => void rows.delete(key),
    list: async () => [...rows.keys()],
  };
}

const cardWith = (settings: Partial<BoatSettingsValues> = {}) =>
  createSpendCard({ access: createBoatAccess({ get: async () => ({ ...SETTINGS, ...settings }) }), kv: memoryKv(), ownerId: OWNER });

test("running lists this server's machines that are up, most expensive first, by the thread they run", async () => {
  boatWith([
    {
      sandboxes: [
        metered("bx_aaaaaaaa", "idle", "small", 0.5, 0.01, machineLabels(OWNER, "thr_small")),
        metered("bx_bbbbbbbb", "archived", "large", 2, 3, machineLabels(OWNER, "thr_stopped")),
        metered("bx_cccccccc", "running", "default", 1, 9, {}),
      ],
      deleted: 1.25,
    },
    {
      sandboxes: [
        metered("bx_dddddddd", "provisioning", "large", 2, 0.5, machineLabels(OWNER, "thr_large")),
        metered("bx_eeeeeeee", "idle", "default", 1, 2, machineLabels("another-server", "thr_theirs")),
      ],
      deleted: 1.25,
    },
  ]);

  const reply = await cardWith().read(AbortSignal.timeout(10_000));

  assert.equal(reply.status, "ready");
  if (reply.status !== "ready") return;
  assert.deepEqual(reply.running, [
    { threadId: "thr_large", size: "large", monthDollars: 0.5, dollarsPerHour: 0.072 },
    { threadId: "thr_small", size: "small", monthDollars: 0.01, dollarsPerHour: 0.018 },
  ]);
  assert.deepEqual(reply.balance, { kind: "left", dollars: 500 * 0.036 });
  assert.equal(reply.renewsAt, Date.parse("2026-12-08T17:35:29Z"));
  assert.equal(reply.days.length, 30);
});

test("each read records the wallet's meter, deleted sandboxes included, so today grows by what it spent", async () => {
  midMonth();
  const card = cardWith();
  boatWith([{ sandboxes: [metered("bx_aaaaaaaa", "idle", "small", 0.5, 1, {})], deleted: 1 }]);
  await card.sample(AbortSignal.timeout(10_000));
  mock.restoreAll();
  boatWith([{ sandboxes: [metered("bx_aaaaaaaa", "idle", "small", 0.5, 1.5, {})], deleted: 1.25 }]);

  const reply = await card.read(AbortSignal.timeout(10_000));

  assert.equal(reply.status === "ready" ? reply.days.at(-1)?.dollars : null, 0.75);
});

test("reads that overlap record in the order they began, so one that finishes late cannot count spend twice", async () => {
  midMonth();
  let release!: (dollars: number) => void;
  boatMetering([1, new Promise((resolve) => (release = resolve)), 2, 2]);
  const card = cardWith();
  await card.sample(signal());

  const slow = card.sample(signal());
  const quick = card.read(signal());
  // why the race: read side by side, the quick read lands first; one at a time, it waits for the slow one.
  await Promise.race([quick, delay(50)]);
  release(1);
  await Promise.all([slow, quick]);

  assert.equal(today(await card.read(signal())), 1);
});

test("each boat account keeps its own days, so a key for another account counts no spend", async () => {
  midMonth();
  let account = "sandbox_a";
  boatMetering([1, 1.5, 10, 1.5], { account: () => account });
  const card = cardWith();
  await card.sample(signal());
  await card.sample(signal());

  account = "sandbox_b";
  const other = await card.read(signal());
  account = "sandbox_a";
  const back = await card.read(signal());

  assert.equal(today(other), 0);
  assert.equal(today(back), 0.5);
});

test("a meter boat counted for last month, received after the month turned, adds nothing to the new month", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-30T23:55:00Z") });
  let since = "2026-11-01T00:00:00.000Z";
  boatMetering([10, 10.02, 0.01], { since: () => since });
  const card = cardWith();
  await card.sample(signal());

  mock.timers.setTime(Date.parse("2026-12-01T00:00:01Z"));
  const late = await card.read(signal());
  since = "2026-12-01T00:00:00.000Z";
  const next = await card.read(signal());

  assert.equal(today(late), 0);
  assert.equal(today(next), 0.01);
});

test("with no key the card says why in one message, and sampling does nothing", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => Response.json({}));
  const card = cardWith({ apiKey: undefined });

  const reply = await card.read(AbortSignal.timeout(10_000));
  await card.sample(AbortSignal.timeout(10_000));

  assert.deepEqual(reply, { status: "unavailable", message: "No boat API key is set. Fix it in Settings → boat Sandbox." });
  assert.equal(fetch.mock.callCount(), 0);
});
