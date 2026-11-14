// homepageSection: boat spend under the new-thread composer. A header with the 30-day total, the
// daily chart, the boats running now (beside the chart on a wide card) and the money left; or one line
// saying why there is none. Under the homepage's top row (Activity beside PR Reviews) it is at least
// as tall as that row, so the cards read as one grid.
import { experimental_Icon as Icon, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { boatSandboxContract as contract, type SpendCardReply } from "../../contract.ts";
import { BoatMark } from "../boat-mark.tsx";
import { useEvery } from "./clock.ts";
import { dayLabel, timeLabel, usd } from "./format.ts";
import { RunningList } from "./running-list.tsx";
import { SpendChart } from "./spend-chart.tsx";

/** boat's meter moves by itself, so the card reads again about once a minute. */
const REFRESH_MS = 60_000;
const BILLING_URL = "https://boat.dev/dashboard?tab=billing";
/** bb's ids for this card's homepage section (app.tsx), and for Activity's and PR Reviews' (homepage.css). */
const SECTION_ID = "plugin-homepage:boat-sandbox:spend";
const ACTIVITY_ID = "plugin-homepage:homepage:activity";
const PR_REVIEWS_ID = "plugin-homepage:pr-reviews:pull-requests";

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
      <div className="bs-body">
        <SpendChart days={reply.days} />
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

/** The height of the homepage's top row, Activity's section, while homepage.css lays Activity and
    PR Reviews out beside each other above this card; null otherwise, so the card keeps its natural
    height (without PR Reviews, bb stacks this card above Activity). why watch the sections' shared
    parent: it resizes whenever either section appears, leaves or changes height, and the top row never
    sizes from this card's. */
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
