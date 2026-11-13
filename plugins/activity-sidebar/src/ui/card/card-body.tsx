// What the hover card says (P:1223-1257, Z:ds/session_card.luau): its title, up to three lines; its
// state line; its machine, project and branch ("· worktree off main"); its pull request; while it is
// under way, its plan; its subthread tree. No latest message. The reads only the card pays for: a
// worktree's base branch, and the plan.
import { useSdk, type PluginBrowserBbSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { stateLine, type StateLine } from "../../card/state-line.ts";
import { subthreadLines } from "../../card/subthread-tree.ts";
import { useAsk } from "../../data/use-asks.ts";
import { useMinute } from "../../data/use-minute.ts";
import { usePlan } from "../../data/use-plan.ts";
import { usePullRequest } from "../../data/pull-request/use-pull-request.ts";
import { useRead } from "../../data/use-read.ts";
import { UNDER_WAY, withAsk } from "../../model/state.ts";
import { PrBadge } from "../row/pr-badge.tsx";
import { sleepGlyph } from "../row/sleep-glyphs.tsx";
import { StateGlyph } from "../state-glyph.tsx";
import { CardGlyph } from "./card-glyphs.tsx";
import type { CardData, RowItem } from "./hover-card.tsx";
import { PlanSection } from "./plan-section.tsx";
import { SubthreadSection } from "./subthread-section.tsx";

type Props = { item: RowItem; data: CardData; onOpen(threadId: string): void };

export function CardBody({ item, data, onOpen }: Props) {
  const { row } = item;
  const t = row.thread;
  const now = useMinute();
  const ask = useAsk(t);
  const pr = usePullRequest(t.environment?.id ?? null);
  const base = useBaseBranch(t);
  const state = row.corner.kind === "state" ? withAsk(row.corner.state, ask) : null;
  const plan = usePlan(state !== null && UNDER_WAY.has(state) ? t.id : null);
  const line = stateLine(row, state, data.underWaySince.get(t.id) ?? t.updatedAt, now);
  const branch = t.environment?.branchName ?? null;
  const tree = data.index.childrenOf(t.id).length > 0 ? subthreadLines(data.index, t) : null;

  return (
    <>
      <div className="as-card-title">{t.displayTitle}</div>
      <div className="as-card-lines">
        <Line glyph={stateGlyph(line)}>
          {line.lead}
          {line.note !== null && <i> · {line.note}</i>}
        </Line>
        {/* why: an unknown machine is left unsaid, as Zeron's card leaves a device it can't name (Z:ds/session_card.luau:89-95). */}
        {t.host !== null && <Line glyph={<CardGlyph name="laptop" />}>{t.host.name}</Line>}
        <Line glyph={<CardGlyph name="folder" />}>{row.project.name}</Line>
        {branch !== null && (
          <Line glyph={<CardGlyph name="branch" />} after={t.environment?.isWorktree ? <i>· worktree{base === null ? "" : ` off ${base}`}</i> : null}>
            {branch}
          </Line>
        )}
        {pr !== null && (
          <Line glyph={null} after={<PrBadge pr={pr} />}>
            {pr.title}
          </Line>
        )}
      </div>
      <PlanSection read={plan} />
      {tree !== null && (
        <>
          <div className="as-card-rule" />
          <SubthreadSection tree={tree} now={now} onOpen={onOpen} onShowAll={() => onOpen(t.id)} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * A line: a 12 glyph and its words, cut with "…" at the card's edge. `after` stays whole after them:
 * the branch gives way before where it runs, which is short and new (P:1247-1249).
 */
function Line({ glyph, after = null, children }: { glyph: ReactNode; after?: ReactNode; children: ReactNode }) {
  return (
    <div className="as-card-line">
      <span className="as-card-g">{glyph}</span>
      <span className="as-card-t">{children}</span>
      {after !== null && <span className="as-card-after">{after}</span>}
    </div>
  );
}

function stateGlyph(line: StateLine): ReactNode {
  switch (line.glyph.kind) {
    case "state":
      return <StateGlyph state={line.glyph.state} size={12} />;
    case "asleep":
      return sleepGlyph("Moon");
    case "clock":
      return <CardGlyph name="clock" />;
    default:
      line.glyph satisfies never;
      return null;
  }
}

type ThreadGetResult = Awaited<ReturnType<PluginBrowserBbSdk["threads"]["get"]>>;

/** What a worktree branched off ("main"), read once per card; null for any other checkout or until read. */
function useBaseBranch(t: PluginSidebarThread): string | null {
  const sdk = useSdk();
  const key = t.environment?.isWorktree ? t.id : null;
  const base = useRead(key, (signal) => sdk.threads.get({ threadId: t.id, include: "environment", signal }).then(baseBranchOf));
  return base ?? null;
}

/**
 * bb answers with the environment only when asked to include it. A worktree made without a base names
 * none; bb's merge base is then the branch it was cut from (checked live: null base, merge base "main").
 * Either may be a remote's ("origin/main").
 */
function baseBranchOf(result: ThreadGetResult): string | null {
  const env = "environment" in result ? result.environment : null;
  const base = env == null ? null : (env.baseBranch ?? env.mergeBaseBranch);
  return base === null ? null : base.replace(/^origin\//, "");
}
