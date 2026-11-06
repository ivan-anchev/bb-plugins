// What the strip and the Subagents tab show: the strip's rows and what it
// leaves out, the tab's batches (one per user prompt), each batch's label, the
// census words, the elapsed span, each row's elapsed time, an expanded row's
// meta line, and the status words the strip and the tabs share. A row's detail
// line is detail-line.ts's.
import { formatClockTime, formatDuration } from "./clock.ts";
import type { Delegate, DelegateId, DelegateStatus, Turn, TurnMessage } from "./delegate.ts";
import { firstLine, trailSteps } from "./steps.ts";

/**
 * One user prompt and every delegate launched from it until the next one, however many turns that
 * spans: turns an agent's or bb's own message started, or none (the agent continuing on its own), fold in.
 */
export type Batch = {
  /** The prompt's row id; null for delegates launched before the thread's first user prompt. */
  id: string | null;
  startedAt: number;
  /** The label's text: the prompt's first line, cleaned up (promptLine). */
  label: string;
  /** The prompt in full, for the label's tooltip; null when the thread holds no message at all. */
  prompt: string | null;
  /** Oldest first. */
  delegates: Delegate[];
  /** The latest batch, and any batch with a delegate still running, start open. */
  opensByDefault: boolean;
};

/** What the strip shows, and what it leaves to the Subagents tab. */
export type Roster = {
  /** The latest batch's delegates, plus any still running from an earlier batch, oldest first. */
  rows: Delegate[];
  /** The latest batch: the strip's elapsed time is its span. */
  latest: Batch;
  /** Every delegate the strip leaves out, for its previous row: rows + previous total = the thread's total. */
  previous: { total: number; parts: CensusPart[] };
};

/** The strip's scope; null for a thread with no delegates. */
export function selectRoster(delegates: readonly Delegate[], turns: readonly Turn[]): Roster | null {
  const batches = batchesOf(delegates, turns);
  const latest = batches.at(-1);
  if (!latest) return null;
  const shown = (d: Delegate) => latest.delegates.includes(d) || isRunning(d);
  const left = batches.flatMap((batch) => batch.delegates).filter((d) => !shown(d));
  return {
    rows: batches.flatMap((batch) => batch.delegates.filter(shown)),
    latest,
    // why: only what ended badly is worth naming; a running one is in the strip already.
    previous: { total: left.length, parts: batchCensus(left).filter((p) => p.status === "failed" || p.status === "stopped") },
  };
}

/** The Subagents tab's scope: every delegate, in batches, newest batch first. A prompt that launched nothing has no batch. */
export function selectBatches(delegates: readonly Delegate[], turns: readonly Turn[]): Batch[] {
  return batchesOf(delegates, turns).toReversed();
}

type CensusPart = {
  status: DelegateStatus;
  count: number;
  word: string;
  /** The newest delegate with this status: where a click on the part lands in the Subagents tab. */
  newest: DelegateId;
};

/** The strip's and the Subagents tab header's census: "N subagents", then running, failed, stopped; "done" only when nothing else is left. */
export function census(delegates: readonly Delegate[]): { total: number; parts: CensusPart[] } {
  const parts = batchCensus(delegates);
  const attention = parts.filter((p) => p.status !== "completed");
  return { total: delegates.length, parts: attention.length > 0 ? attention : parts };
}

/** A batch's census: running, failed, stopped, done, in that order, zeros omitted. */
export function batchCensus(delegates: readonly Delegate[]): CensusPart[] {
  return CENSUS_ORDER.flatMap((status) => {
    const matching = delegates.filter((d) => d.state.status === status);
    if (matching.length === 0) return [];
    const newest = matching.reduce((a, d) => (d.startedAt > a.startedAt ? d : a));
    return [{ status, count: matching.length, word: CENSUS_WORD[status], newest: newest.id }];
  });
}

/** Wall-clock span from the first start to the last end, or to `now` while any runs. */
export function span(delegates: readonly Delegate[], now: number): number {
  const start = Math.min(...delegates.map((d) => d.startedAt));
  const end = Math.max(...delegates.map((d) => endOf(d, now)));
  return end - start;
}

/**
 * An expanded row's meta line, part by part: started 13:58 · ran 4m 48s ·
 * 19 steps · 24 tool calls · 61.2k tokens. "ran" waits for the end, steps
 * need child rows, tool calls need usage, and tokens a figure in it.
 */
export function metaParts(d: Delegate): string[] {
  const { state, steps, usage } = d;
  return [
    `started ${formatClockTime(d.startedAt)}`,
    ...(state.status === "running" ? [] : [`ran ${formatDuration(state.endedAt - d.startedAt)}`]),
    ...(steps ? [plural(trailSteps(steps).length, "step")] : []),
    ...(usage ? [plural(usage.toolUses, "tool call")] : []),
    ...(usage && usage.totalTokens !== null ? [`${formatTokens(usage.totalTokens)} tokens`] : []),
  ];
}

/** One delegate's run time: to `now` while it runs, to its end once settled. */
export function elapsed(d: Delegate, now: number): number {
  return endOf(d, now) - d.startedAt;
}

export const isRunning = (d: Delegate): boolean => d.state.status === "running";

/** "1 step", "2 steps"; "2 searches" given its plural. */
export const plural = (n: number, word: string, words = `${word}s`): string => `${n} ${n === 1 ? word : words}`;

/** A status as one capitalised word: Running, Done, Failed, Stopped. */
export const statusWord = (status: DelegateStatus): string => STATUS_WORD[status];

// ---------------------------------------------------------------- layer 2

// why: what needs attention leads; done is what is left.
const CENSUS_ORDER: readonly DelegateStatus[] = ["running", "failed", "stopped", "completed"];
const CENSUS_WORD: Record<DelegateStatus, string> = { running: "running", completed: "done", failed: "failed", stopped: "stopped" };
const STATUS_WORD: Record<DelegateStatus, string> = { running: "Running", completed: "Done", failed: "Failed", stopped: "Stopped" };

const endOf = (d: Delegate, now: number): number => (d.state.status === "running" ? now : d.state.endedAt);

type Prompt = TurnMessage & { from: "user" };
const isPrompt = (message: TurnMessage): message is Prompt => message.from === "user";

/** Every delegate in batches, oldest batch first: the one grouping both scopes are cut from. */
function batchesOf(delegates: readonly Delegate[], turns: readonly Turn[]): Batch[] {
  const batches = groupByPrompt(delegates, turns.flatMap((turn) => turn.messages).toSorted((a, b) => a.at - b.at));
  return batches.map((batch, i) => ({ ...batch, opensByDefault: i === batches.length - 1 || batch.delegates.some(isRunning) }));
}

/**
 * Batches in prompt order. A delegate joins the batch of the last user prompt sent at or before its
 * launch, whichever turn launched it: a prompt sent while a turn runs (queued or steered) ends the batch
 * before it, so the turn's later launches are the new prompt's.
 */
function groupByPrompt(delegates: readonly Delegate[], messages: readonly TurnMessage[]): Omit<Batch, "opensByDefault">[] {
  const prompts = messages.filter(isPrompt);
  const members = new Map<Prompt | null, Delegate[]>();
  for (const d of delegates.toSorted((a, b) => a.startedAt - b.startedAt)) {
    const prompt = prompts.findLast((p) => p.at <= d.startedAt) ?? null;
    const batch = members.get(prompt);
    if (batch) batch.push(d);
    else members.set(prompt, [d]);
  }
  return [...members]
    .map(([prompt, batch]) => (prompt ? toBatch(prompt, batch) : beforeFirstPrompt(messages, batch)))
    .toSorted((a, b) => a.startedAt - b.startedAt);
}

function toBatch(prompt: Prompt, delegates: Delegate[]): Omit<Batch, "opensByDefault"> {
  return { id: prompt.id, startedAt: prompt.at, label: promptLine(prompt.text), prompt: prompt.text, delegates };
}

/**
 * Delegates launched before any user prompt, under the thread's first message when that was not the user's
 * (an agent's brief); the first prompt labels its own batch.
 */
function beforeFirstPrompt(messages: readonly TurnMessage[], delegates: Delegate[]): Omit<Batch, "opensByDefault"> {
  const [first] = messages;
  const text = first && !isPrompt(first) ? first.text : null;
  return {
    id: null,
    startedAt: Math.min(first?.at ?? Infinity, delegates[0].startedAt),
    label: text === null ? "Before the first prompt" : promptLine(text),
    prompt: text,
    delegates,
  };
}

/**
 * A prompt's first line as a batch's label: without wrapping quotes, or a filler lead-in
 * ("ok,", "now, lets"), so the word that says what was asked comes first.
 */
function promptLine(prompt: string): string {
  const line = firstLine(prompt);
  let text = line.replace(WRAPPING_QUOTES, "$1").trim();
  for (let rest = text.replace(FILLER, ""); rest !== text; rest = text.replace(FILLER, "")) text = rest;
  return text || line;
}

const WRAPPING_QUOTES = /^["'“‘`](.*)["'”’`]$/su;
// why: kept small on purpose; each is a word people open a request with that says nothing about it.
const FILLER = /^(?:ok(?:ay)?|now|so|alright|lets|let's|please)\b[\s,.:;!-]*/iu;

/** 950 / 61.2k / 1.3M */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`;
}
