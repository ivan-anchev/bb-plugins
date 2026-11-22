import type { WorkRow } from "./bb.ts";

type CommandRow = Extract<WorkRow, { workKind: "command" }>;

/** A command that ran well and sent one thread a message, as bb's chat reads it. */
export function isThreadTell(row: CommandRow): boolean {
  if (row.status !== "completed" || (row.exitCode !== null && row.exitCode !== 0)) return false;
  if (!TELL.test(row.command)) return false;
  const words = plainWords(row.command.trim());
  return words !== null && tellsAThread(words);
}

type Word = { text: string; quoted: boolean };

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
    if (quoted) return false;
    const [name, value] = text.split(/=(.*)/su);
    if (FLAGS.has(name) && value === undefined) continue;
    if (!VALUED.has(name)) return false;
    if (value === undefined) i++;
  }
  const [threadId, message, ...extra] = args;
  return extra.length === 0 && threadId !== undefined && THREAD_ID.test(threadId) && message !== undefined && isLiteral(message);
}

function plainWords(line: string): Word[] | null {
  if (!LINE.test(line)) return null;
  return (line.match(WORD) ?? []).map((word) => ({ text: word.replaceAll(QUOTED, "$1$2"), quoted: /['"]/u.test(word) }));
}

function isCli(word: string): boolean {
  return word.split("/").at(-1) === "bb" || /^\$\{?BB_CLI(?::-[^}]*)?\}?$/u.test(word);
}

function isLiteral(message: string): boolean {
  return message.trim() !== "" && !/[$`]/u.test(message);
}

const TELL = /\bthread\s+(?:tell|message)\b/u;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const SEGMENT = /(?:[^\s'"\\|&;<>()`]|'[^']*'|"[^"\\$`]*")+/u.source;
const LINE = new RegExp(`^${SEGMENT}(?:[ \t]+${SEGMENT})*$`, "u");
const WORD = new RegExp(SEGMENT, "gu");
const QUOTED = /'([^']*)'|"([^"]*)"/gu;
const FLAGS = new Set(["--json", "--plan"]);
const VALUED = new Set(["--model", "--service-tier", "--reasoning-level", "--permission-mode", "--mode"]);
const THREAD_ID = /^thr_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u;
