// bb's chat shows a successful `bb thread tell` (or `message`) as a message to that thread, not as
// a command, so it never folds into a group (ThreadScreen bundle: `po`, `fo`, `uo`, and the shell
// parser under them). This reads its plainest form only: one invocation of plain or quoted words.
// bb also reads a heredoc, a message in a variable, an `sh -c` wrapper, a redirect, or a trailing
// `;`; such a command reads here as an ordinary command, so it can fold where bb's line would not.
import type { WorkRow } from "./bb.ts";

type CommandRow = Extract<WorkRow, { workKind: "command" }>;

/** A command that ran well and sent one thread a message, as bb's chat reads it. */
export function isThreadTell(row: CommandRow): boolean {
  if (row.status !== "completed" || (row.exitCode !== null && row.exitCode !== 0)) return false;
  if (!TELL.test(row.command)) return false; // why: bb's cheap first check, before any parsing
  const words = plainWords(row.command.trim());
  return words !== null && tellsAThread(words);
}

// ---------------------------------------------------------------- layer 2

type Word = { text: string; quoted: boolean };

/** bb's `uo`: after any VAR=value, `bb thread tell|message [options] <thread id> <message>`. */
function tellsAThread(words: readonly Word[]): boolean {
  const start = words.findIndex((word) => word.quoted || !ASSIGNMENT.test(word.text));
  const [cli, noun, verb, ...rest] = start === -1 ? [] : words.slice(start);
  if (!cli || !isCli(cli.text) || noun?.text !== "thread" || (verb?.text !== "tell" && verb?.text !== "message")) return false;
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const { text, quoted } = rest[i];
    if (!text.startsWith("-") || text === "-") {
      args.push(text);
      continue;
    }
    if (quoted) return false; // why: bb reads a quoted dash word as an option or not by how it was quoted
    const [name, value] = text.split(/=(.*)/su);
    if (FLAGS.has(name) && value === undefined) continue;
    if (!VALUED.has(name)) return false; // why: --message-file reads the message from stdin or a file
    if (value === undefined) i++; // its value is the next word
  }
  const [threadId, message, ...extra] = args;
  return extra.length === 0 && threadId !== undefined && THREAD_ID.test(threadId) && message !== undefined && isLiteral(message);
}

/**
 * A plain invocation's words: split on blanks, each plain or in single or double quotes, quotes
 * removed. null for anything a shell reads further: an operator, a redirect, a subshell, an
 * escape, a newline outside quotes, an expansion inside double quotes, or an unclosed quote.
 */
function plainWords(line: string): Word[] | null {
  if (!LINE.test(line)) return null;
  return (line.match(WORD) ?? []).map((word) => ({ text: word.replaceAll(QUOTED, "$1$2"), quoted: /['"]/u.test(word) }));
}

// ---------------------------------------------------------------- layer 3

/** `bb` by any path, or bb's own `$BB_CLI` (bb's `Xa`, `no`). */
function isCli(word: string): boolean {
  return word.split("/").at(-1) === "bb" || /^\$\{?BB_CLI(?::-[^}]*)?\}?$/u.test(word);
}

/** bb's `lo`: a message that says something, and no variable or command to expand. */
function isLiteral(message: string): boolean {
  return message.trim() !== "" && !/[$`]/u.test(message);
}

const TELL = /\bthread\s+(?:tell|message)\b/u;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
// why: each alternative starts on a different character, so matching stays linear on long commands.
const SEGMENT = /(?:[^\s'"\\|&;<>()`]|'[^']*'|"[^"\\$`]*")+/u.source;
const LINE = new RegExp(`^${SEGMENT}(?:[ \t]+${SEGMENT})*$`, "u");
const WORD = new RegExp(SEGMENT, "gu");
const QUOTED = /'([^']*)'|"([^"]*)"/gu;
/** bb's options that take no value, and those that take one (`eo`, `$a` less --message-file). */
const FLAGS = new Set(["--json", "--plan"]);
const VALUED = new Set(["--model", "--service-tier", "--reasoning-level", "--permission-mode", "--mode"]);
/** bb's thread id (`Go` in its index bundle). */
const THREAD_ID = /^thr_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u;
