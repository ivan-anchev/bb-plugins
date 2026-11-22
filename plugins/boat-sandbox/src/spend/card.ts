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
const historyKey = (account: Account["id"]): string => `spend-history:${account}`;
const UNLIMITED = "This boat account has no plan or wallet, so there is no spend to count against.";
const FIX_IN_SETTINGS = "Fix it in Settings → boat Sandbox.";
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
      const filled = await serially(async () => {
        const before = await storedHistory(account);
        signal.throwIfAborted();
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

const cardLine = (problems: readonly Problem[]): string => [...problems.map((problem) => problem.message), FIX_IN_SETTINGS].join(" ");

function backfillFailure(error: unknown): string {
  if (error instanceof BoatApiError && error.status === 403) return NEEDS_ADMIN_SCOPE;
  const why = error instanceof BoatApiError ? `HTTP ${error.status}` : error instanceof z.ZodError ? "boat changed its reply" : "boat couldn’t be reached";
  return `Couldn’t backfill: boat’s daily spend is unavailable (${why}).`;
}

const monthToDate = (meter: WalletMeter): number =>
  meter.sandboxes.reduce((sum, metered) => sum + metered.monthDollars, meter.deletedDollars);

const utcMonth = (at: number): string => new Date(at).toISOString().slice(0, 7);

function runningBoats(meter: WalletMeter, ownerId: string, billing: Billing): RunningBoat[] {
  return meter.sandboxes
    .flatMap(({ sandbox, monthDollars, billingMultiplier }) => {
      const threadId = machineKeyOf(sandbox.labels, ownerId);
      if (threadId === null || !isAwake(sandbox)) return [];
      return [{ threadId, size: sandbox.type, monthDollars, dollarsPerHour: dollarsPerHour(billingMultiplier, billing) }];
    })
    .sort((a, b) => b.monthDollars - a.monthDollars);
}

function createQueue() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task);
    last = run.catch(() => undefined);
    return run;
  };
}
