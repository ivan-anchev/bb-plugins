import { experimental_Icon as Icon, experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { boatSandboxContract as contract, type SpendCardReply } from "../../contract.ts";
import type { SpendDay } from "../../spend/history.ts";
import { BoatMark } from "../boat-mark.tsx";
import { useEvery } from "./clock.ts";
import { dayLabel, timeLabel, usd } from "./format.ts";
import { RunningList } from "./running-list.tsx";
import { SpendChart, type Backfill } from "./spend-chart.tsx";

const REFRESH_MS = 60_000;
const BILLING_URL = "https://boat.dev/dashboard?tab=billing";
const SECTION_ID = "plugin-homepage:boat-sandbox:spend";
const ACTIVITY_ID = "plugin-homepage:homepage:activity";
const PR_REVIEWS_ID = "plugin-homepage:pr-reviews:pull-requests";
const FILLED_NOTICE_MS = 3_000;

type Ready = Extract<SpendCardReply, { status: "ready" }>;

export function SpendCard() {
  const query = experimental_useRpcQuery({ contract, method: "spendCard", input: {} });
  useEvery(REFRESH_MS, query.refetch);
  const reply = query.data;
  const failure = query.error?.message ?? null;
  if (reply?.status === "ready") return <ReadyCard reply={reply} failure={failure} refetch={query.refetch} />;
  const line = failure !== null ? `Couldn’t read boat: ${failure}` : reply?.status === "unavailable" ? reply.message : "Reading boat…";
  return (
    <Card total={null}>
      <p className="bs-caption bs-reason">{line}</p>
    </Card>
  );
}

function ReadyCard({ reply, failure, refetch }: { reply: Ready; failure: string | null; refetch: () => Promise<void> }) {
  const backfill = useBackfill(reply.days, refetch);
  const total = reply.days.reduce((sum, day) => sum + (day.dollars ?? 0), 0);
  const owed = reply.balance.kind === "owed";
  return (
    <Card total={total}>
      {failure !== null && (
        <p className="bs-caption bs-stale" role="status">
          <Icon name="AlertTriangle" className="bs-stale-icon" aria-hidden />
          <span>
            Couldn’t refresh since {timeLabel(reply.readAt)}. {failure}
          </span>
        </p>
      )}
      {owed && <OwedNotice dollars={reply.balance.dollars} />}
      <div className="bs-body">
        <SpendChart days={reply.days} backfill={backfill} />
        <RunningList boats={reply.running} readAt={reply.readAt} live={failure === null} />
      </div>
      <div className="bs-foot bs-caption">
        <span data-owed={owed || undefined}>{usd(reply.balance.dollars)} {owed ? "owed" : "left"}</span>
        {reply.renewsAt !== null && <span className="bs-end">Renews {dayLabel(reply.renewsAt)}</span>}
      </div>
    </Card>
  );
}

function Card({ total, children }: { total: number | null; children: ReactNode }) {
  const card = useRef<HTMLElement>(null);
  const rowHeight = useTopRowHeight(card);
  return (
    <section ref={card} className="bs-card" aria-label="boat spend" style={{ minHeight: rowHeight ?? undefined }}>
      <div className="bs-head">
        <BoatMark className="bs-icon" />
        <span>boat spend</span>
        {total !== null && (
          <span className="bs-total bs-end">
            <b>{usd(total)}</b> · 30 days
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function OwedNotice({ dollars }: { dollars: number }) {
  return (
    <div className="bs-notice" role="status">
      <Icon name="AlertTriangle" className="bs-notice-icon" aria-hidden />
      <span>
        Plan time is used up and the wallet owes {usd(dollars)}. Sandboxes stop unless you{" "}
        <a className="bs-link" href={BILLING_URL} target="_blank" rel="noopener noreferrer">
          add money
        </a>
        .
      </span>
    </div>
  );
}

function useTopRowHeight(card: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const sections = card.current?.closest(`[id="${SECTION_ID}"]`)?.parentElement;
    if (!sections) return;
    const observer = new ResizeObserver(() => {
      const activity = document.getElementById(ACTIVITY_ID);
      const inTopRow = activity !== null && document.getElementById(PR_REVIEWS_ID) !== null;
      setHeight(inTopRow ? activity.getBoundingClientRect().height : null);
    });
    observer.observe(sections);
    return () => observer.disconnect();
  }, [card]);
  return height;
}

function useBackfill(days: readonly SpendDay[], refetch: () => Promise<void>): Backfill | null {
  const mutation = experimental_useRpcMutation({ contract, method: "backfillSpend" });
  const [phase, setPhase] = useState<BackfillPhase>({ kind: "idle" });
  const [failure, setFailure] = useState<string | null>(null);
  const unrecorded = days.filter((day) => day.dollars === null).length;

  useEffect(() => {
    if (phase.kind !== "filled") return;
    const timer = setTimeout(() => setPhase({ kind: "idle" }), FILLED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (unrecorded === 0) return null;
  return {
    label: phase.kind === "pending" ? "Backfilling…" : phase.kind === "filled" ? filledLabel(phase.days) : "Backfill 30 days",
    busy: phase.kind !== "idle",
    failure,
    async run() {
      setPhase({ kind: "pending" });
      setFailure(null);
      try {
        const reply = await mutation.mutate({});
        if (reply.status === "unavailable") {
          setFailure(reply.message);
          setPhase({ kind: "idle" });
          return false;
        }
        await refetch();
        const all = reply.days >= unrecorded;
        setPhase(all ? { kind: "idle" } : { kind: "filled", days: reply.days });
        return all;
      } catch (error) {
        setFailure(`Couldn’t backfill: ${error instanceof Error ? error.message : String(error)}`);
        setPhase({ kind: "idle" });
        return false;
      }
    },
  };
}

type BackfillPhase = { kind: "idle" } | { kind: "pending" } | { kind: "filled"; days: number };

const filledLabel = (days: number): string => (days === 0 ? "Nothing to fill" : `Filled ${days} ${days === 1 ? "day" : "days"}`);
