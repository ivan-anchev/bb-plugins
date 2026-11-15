// The homepage card's read: boat's meter and plan, this server's machines that are up, and the spend
// days recorded so far. Every read of the meter, the card's or the schedule's, is recorded. A backfill
// fills the days before recording began from boat's own daily numbers.
import type { ExperimentalPluginRpcHandlersWithContext, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { BoatAccess } from "../boat/access.ts";
import { BoatApiError, type BoatClient, type WalletMeter } from "../boat/client.ts";
import { isAwake } from "../boat/sandbox.ts";
import type { Account, Billing, DaySpend } from "../boat/wire.ts";
import type { BackfillSpendReply, boatSandboxContract, RunningBoat, SpendCardReply } from "../contract.ts";
import { machineKeyOf } from "../ownership.ts";
import { describeProblems, type Problem } from "../problem.ts";
import { backfill, record, spendDays, spendHistory, type Reading, type SpendHistory } from "./history.ts";
import { balanceOf, dollarsPerHour } from "./money.ts";

const DAYS = 30;
/** One history per boat account: a key for another account reads another meter. */
const historyKey = (account: Account["id"]): string => `spend-history:${account}`;
const UNLIMITED = "This boat account has no plan or wallet, so there is no spend to count against.";
/** Every problem that stops the card, a missing or refused key or an account boat Sandbox refuses, is fixed there. */
const FIX_IN_SETTINGS = "Fix it in Settings → boat Sandbox.";
/** boat's daily numbers come from its account API, which a key without `account.admin` (a `ci` key) cannot read. */
const NEEDS_ADMIN_SCOPE = "Backfill needs a boat API key with the account.admin scope. Change the key in Settings → boat Sandbox.";

interface SpendCard {
  /** The card. Throws when boat cannot be read, so the app keeps its last good numbers. */
  read(signal: AbortSignal): Promise<SpendCardReply>;
  /** Records a reading of the meter; nothing without a key, and throws when boat refuses or cannot be read. */
  sample(signal: AbortSignal): Promise<void>;
  /** Fills the chart's unrecorded days from boat's own daily numbers; any failure leaves the days as they were. */
  backfill(signal: AbortSignal): Promise<BackfillSpendReply>;
}

export function createSpendCard({ access, kv, ownerId }: { access: BoatAccess; kv: PluginKvStorage; ownerId: string }): SpendCard {
  const serially = createQueue();

  const storedHistory = async (account: Account["id"]): Promise<SpendHistory | null> => {
    const stored = await kv.get<unknown>(historyKey(account));
    return stored === undefined ? null : spendHistory.parse(stored);
  };

  /**
   * Reads the meter and records it, one look at a time: two reads in flight could land out of order,
   * and a lower meter landing last would reset the baseline, so the next reading counts spend twice.
   * A meter boat counted before the UTC month turned holds last month's spend, so it is not recorded.
   */
  const look = (client: BoatClient, account: Account["id"], signal: AbortSignal) =>
    serially(async () => {
      const meter = await client.meter(signal);
      const reading: Reading = { at: Date.now(), monthDollars: monthToDate(meter) };
      const before = await storedHistory(account);
      if (utcMonth(meter.since) !== utcMonth(reading.at)) return { meter, reading, history: before };
      const history = record(before, reading);
      await kv.set(historyKey(account), history);
      return { meter, reading, history };
    });

  return {
    async read(signal) {
      const configuration = await access.configuration(signal);
      switch (configuration.status) {
        case "available": {
          const billing = configuration.facts.limits.billing;
          if (billing === null) return { status: "unavailable", message: UNLIMITED };
          const { meter, reading, history } = await look(configuration.client, configuration.facts.account.id, signal);
          return {
            status: "ready",
            readAt: reading.at,
            days: spendDays(history, reading.at, DAYS),
            running: runningBoats(meter, ownerId, billing),
            balance: balanceOf(billing),
            renewsAt: billing.renewsAt,
          };
        }
        case "setup-required":
        case "refused":
          return { status: "unavailable", message: cardLine(configuration.problems) };
        case "read-failed":
          throw new Error(configuration.problems[0].message);
        default:
          return configuration satisfies never;
      }
    },
    async sample(signal) {
      const configuration = await access.configuration(signal);
      // No key means nothing to meter; a refused key or a failed read leaves a gap, so it fails loudly.
      if (configuration.status === "setup-required") return;
      if (configuration.status !== "available") throw new Error(describeProblems(configuration.problems));
      await look(configuration.client, configuration.facts.account.id, signal);
    },
    async backfill(signal) {
      const configuration = await access.configuration(signal);
      if (configuration.status === "read-failed") return { status: "unavailable", message: configuration.problems[0].message };
      if (configuration.status !== "available") return { status: "unavailable", message: cardLine(configuration.problems) };
      let boatDays: DaySpend[];
      try {
        boatDays = await configuration.client.dailySpend(signal);
      } catch (error) {
        return { status: "unavailable", message: backfillFailure(error) };
      }
      const account = configuration.facts.account.id;
      // In the readings' queue, so a reading cannot land between this read of the history and its write.
      const filled = await serially(async () => {
        const before = await storedHistory(account);
        // A call cancelled while it waited or read, or a plugin reloaded meanwhile, stops before it writes.
        signal.throwIfAborted();
        // Nothing recorded yet means no reading has fixed where today's meter starts; the card's next read does.
        if (before === null) return 0;
        const after = backfill(before, boatDays, Date.now(), DAYS);
        if (after.filled > 0) await kv.set(historyKey(account), after.history);
        return after.filled;
      });
      return { status: "filled", days: filled };
    },
  };
}

export const spendCardRpcHandlers = (
  card: SpendCard,
): Pick<ExperimentalPluginRpcHandlersWithContext<typeof boatSandboxContract>, "spendCard" | "backfillSpend"> => ({
  spendCard: (_input, { experimental_signal: signal }) => card.read(signal),
  backfillSpend: (_input, { experimental_signal: signal }) => card.backfill(signal),
});

/** One short line for the card: what is wrong, and where to fix it. bb's status line carries the full steps. */
const cardLine = (problems: readonly Problem[]): string => [...problems.map((problem) => problem.message), FIX_IN_SETTINGS].join(" ");

/**
 * One line for a failed backfill. The route is boat's undocumented dashboard API, so a 404 or a reply
 * that no longer parses means boat changed it.
 */
function backfillFailure(error: unknown): string {
  if (error instanceof BoatApiError && error.status === 403) return NEEDS_ADMIN_SCOPE;
  const why = error instanceof BoatApiError ? `HTTP ${error.status}` : error instanceof z.ZodError ? "boat changed its reply" : "boat couldn’t be reached";
  return `Couldn’t backfill: boat’s daily spend is unavailable (${why}).`;
}

/** The wallet's machine time this month: every sandbox's, the deleted ones' too. */
const monthToDate = (meter: WalletMeter): number =>
  meter.sandboxes.reduce((sum, metered) => sum + metered.monthDollars, meter.deletedDollars);

/** `2026-11`. */
const utcMonth = (at: number): string => new Date(at).toISOString().slice(0, 7);

/** This server's machine sandboxes that are up, most expensive first. */
function runningBoats(meter: WalletMeter, ownerId: string, billing: Billing): RunningBoat[] {
  return meter.sandboxes
    .flatMap(({ sandbox, monthDollars, billingMultiplier }) => {
      const threadId = machineKeyOf(sandbox.labels, ownerId);
      if (threadId === null || !isAwake(sandbox)) return [];
      return [{ threadId, size: sandbox.type, monthDollars, dollarsPerHour: dollarsPerHour(billingMultiplier, billing) }];
    })
    .sort((a, b) => b.monthDollars - a.monthDollars);
}

/** Runs each task after the one before it settles, failed or not. */
function createQueue() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task);
    // why: the caller sees a failed task; the queue only waits for it to settle.
    last = run.catch(() => undefined);
    return run;
  };
}
