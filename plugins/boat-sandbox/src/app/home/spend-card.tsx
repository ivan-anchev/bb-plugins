// homepageSection: boat spend under the new-thread composer. A header with the 30-day total, the
// daily chart, the boats running now and the money left; or one line saying why there is none.
import { experimental_Icon as Icon, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { boatSandboxContract as contract, type SpendCardReply } from "../../contract.ts";
import { BoatMark } from "../boat-mark.tsx";
import { useEvery } from "./clock.ts";
import { dayLabel, timeLabel, usd } from "./format.ts";
import { RunningList } from "./running-list.tsx";
import { SpendChart } from "./spend-chart.tsx";

/** boat's meter moves by itself, so the card reads again about once a minute. */
const REFRESH_MS = 60_000;
const BILLING_URL = "https://boat.dev/dashboard?tab=billing";

type Ready = Extract<SpendCardReply, { status: "ready" }>;

export function SpendCard() {
  const query = experimental_useRpcQuery({ contract, method: "spendCard", input: {} });
  useEvery(REFRESH_MS, query.refetch);
  // A failed refresh keeps the last good reply in `data` and sets `error` beside it.
  const reply = query.data;
  const failure = query.error?.message ?? null;
  if (reply?.status === "ready") return <ReadyCard reply={reply} failure={failure} />;
  const line = failure !== null ? `Couldn’t read boat: ${failure}` : reply?.status === "unavailable" ? reply.message : "Reading boat…";
  return (
    <Card total={null}>
      <p className="bs-caption bs-reason">{line}</p>
    </Card>
  );
}

/** `failure`: why the last refresh failed; the numbers stay, marked with when they were read, and stop ticking. */
function ReadyCard({ reply, failure }: { reply: Ready; failure: string | null }) {
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
      <SpendChart days={reply.days} />
      <RunningList boats={reply.running} readAt={reply.readAt} live={failure === null} />
      <div className="bs-foot bs-caption">
        <span data-owed={owed || undefined}>{usd(reply.balance.dollars)} {owed ? "owed" : "left"}</span>
        {reply.renewsAt !== null && <span className="bs-end">Renews {dayLabel(reply.renewsAt)}</span>}
      </div>
    </Card>
  );
}

function Card({ total, children }: { total: number | null; children: ReactNode }) {
  return (
    <section className="bs-card" aria-label="boat spend">
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
