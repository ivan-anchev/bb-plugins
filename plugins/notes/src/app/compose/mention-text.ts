// The @ thread links of the form's textarea, as pure rules over its text. The text is the only
// truth: a thread is linked while its "@Title" token is in the text. Picking a thread writes the
// token, deleting the token unlinks it, and saving turns every token into a mention range.
import type { NoteBody } from "../../contract.ts";

/** A thread the user picked in this draft: the title its token reads, and the thread it points to. */
export type PickedThread = { threadId: string; title: string };

/** The textarea's text and caret, a UTF-16 offset into it. */
export type Draft = { text: string; caret: number };

/**
 * What follows an "@" before the caret ("see @bur" → "bur"), or null when the caret is not in one.
 * A finished link is no query: once the caret is past a picked thread's token, typing on after it
 * does not reopen the picker.
 */
export function activeQuery(draft: Draft, picked: readonly PickedThread[]): string | null {
  const from = openQueryFrom(draft, picked);
  return from === null ? null : draft.text.slice(from + 1, draft.caret);
}

/** Replaces the open "@query" before the caret with "@Title ", and puts the caret after it. */
export function insertToken(draft: Draft, picked: readonly PickedThread[], thread: PickedThread): Draft {
  // why asserted: a pick only comes from the picker, which is open only while a query is.
  const before = `${draft.text.slice(0, openQueryFrom(draft, picked)!)}${tokenOf(thread)} `;
  return { text: before + draft.text.slice(draft.caret), caret: before.length };
}

/** Types an "@" at the caret, after a space when it would otherwise touch the word before it. */
export function insertAtSign({ text, caret }: Draft): Draft {
  const sign = caret === 0 || /\s/.test(text[caret - 1]) ? "@" : " @";
  return { text: text.slice(0, caret) + sign + text.slice(caret), caret: caret + sign.length };
}

/** The picked threads with a token still in the text, once each: the chips under the field. */
export function linkedThreads(text: string, picked: readonly PickedThread[]): PickedThread[] {
  return [...new Set(linksIn(text, picked).map((link) => link.thread))];
}

/** Unlinks `thread`: removes every one of its tokens, each with the space after it. */
export function removeToken(draft: Draft, picked: readonly PickedThread[], thread: PickedThread): Draft {
  const token = tokenOf(thread);
  return linksIn(draft.text, picked)
    .filter((link) => tokenOf(link.thread) === token)
    .reduceRight((edited, { from, to }) => cut(edited, from, edited.text[to] === " " ? to + 1 : to), draft);
}

/** The body a note saves: the trimmed text, and a mention for every token of a picked thread. */
export function toNoteBody(text: string, picked: readonly PickedThread[]): NoteBody {
  // why trimmed first: the offsets must index the text that is stored.
  const trimmed = text.trim();
  return { text: trimmed, mentions: linksIn(trimmed, picked).map(({ thread, from, to }) => ({ threadId: thread.threadId, from, to })) };
}

// ------------------------------------------------------------------ layer 2

/** Up to 40 characters, on one line: what may follow the "@" of an open query. */
const QUERY = /^[^\n]{0,40}$/;

type Link = { thread: PickedThread; from: number; to: number };

/**
 * Where the open query's "@" sits, or null when the caret is in none. It is the last "@" before the
 * caret, unless that "@" is part of a picked title ("@Links with @"): then the query starts at its
 * token, and is closed once the caret is past that token.
 */
function openQueryFrom({ text, caret }: Draft, picked: readonly PickedThread[]): number | null {
  const at = text.slice(0, caret).lastIndexOf("@");
  if (at === -1) return null;
  const link = linksIn(text, picked).find(({ from, to }) => from <= at && at < to);
  if (link !== undefined && link.to < caret) return null;
  const from = link?.from ?? at;
  return QUERY.test(text.slice(from + 1, caret)) ? from : null;
}

const tokenOf = (thread: PickedThread): string => `@${thread.title}`;

/** Every token of a picked thread in `text`, in order and never overlapping. */
function linksIn(text: string, picked: readonly PickedThread[]): Link[] {
  const found = [...threadsByToken(picked)].flatMap(([token, thread]) =>
    occurrences(text, token).map((from) => ({ thread, from, to: from + token.length })),
  );
  return withoutOverlaps(found.sort((a, b) => a.from - b.from || b.to - a.to));
}

/** Two threads with one title write the same token; the later pick owns it. */
function threadsByToken(picked: readonly PickedThread[]): Map<string, PickedThread> {
  return new Map(picked.map((thread) => [tokenOf(thread), thread]));
}

function occurrences(text: string, token: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, at + token.length)) found.push(at);
  return found;
}

/** "@Burn weekly" holds "@Burn": of two links at one place, the longer one, sorted first, stays. */
function withoutOverlaps(sorted: readonly Link[]): Link[] {
  const kept: Link[] = [];
  for (const link of sorted) {
    const last = kept.at(-1);
    if (last === undefined || link.from >= last.to) kept.push(link);
  }
  return kept;
}

/** Removes `text[from, to)`, keeping the caret on the same character. */
function cut({ text, caret }: Draft, from: number, to: number): Draft {
  return { text: text.slice(0, from) + text.slice(to), caret: caret <= from ? caret : Math.max(from, caret - (to - from)) };
}
