import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { test } from "node:test";
import { makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import { coordinatorContract } from "./contract.ts";
import { harness, newThreadRequest, profileNamed } from "./server/test-harness.ts";

const PLUGIN = join(import.meta.dirname, "..");

const MEANING = `"crew" means all of one regional manager's agents. One delegated thread is an agent (a1, agent_start); one piece of work is an issue (WEB-1, issue_create).`;

const FLEET_TOOLS = new Set(["crew_catch_up", "crew_memory_read", "crew_memory_write", "crew_remind", "crew_ask_user"]);

const RETIRED_NAMES = new Map([
  ["_start", "agent_start"],
  ["_message", "agent_message"],
  ["_read", "issue_read"],
  ["_close", "agent_stop"],
  ["_handoff", "agent_handoff"],
  ["_verdict", "issue_verdict"],
  ["-work", "agent-work"],
]);

const ONE_THREADS_THINGS = ["thread", "threads", "row", "rows", "id", "ids", "branch", "branches", "worktree", "worktrees"];

test(`no retired single-thread name, no "crew" given one thread's things, and no id from before agents comes back`, () => {
  const misuses = scannedFiles().flatMap(misusesIn);
  assert.equal(misuses.length, 0, `${MEANING} Rename these:\n${misuses.join("\n")}`);
});

test("the only tools named crew_ are the five about every agent at once", async () => {
  const loaded = harness().load(plugin);
  const { coordinatorId } = coordinatorContract.createCoordinator.output.parse(await loaded.callRpc("createCoordinator", { profile: profileNamed("Webhooks") }));
  const { threadId } = coordinatorContract.startCoordinator.output.parse(await loaded.callRpc("startCoordinator", { coordinatorId, request: newThreadRequest("Migrate the webhook service") }));
  const configured = await loaded.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: threadId } }));
  assert.deepEqual(loaded.logEntries.filter(({ level }) => level !== "info"), [], "bb refused the entry point's configuration");
  const offered = [...loaded.registrations.agentTools, ...configured.tools].map(({ name }) => name);
  const crewTools = new Set(offered.filter((name) => name.startsWith("crew_")));
  assert.deepEqual(crewTools, FLEET_TOOLS, `${MEANING} A tool for one agent is named agent_, one for one issue issue_.`);
});

const NAME = /[\w-]+(?:\.[\w-]+)*/g;
const JOINT = /[_.-]|(?<=[a-z0-9])(?=[A-Z])/;
const NEXT_WORD = /^(?:'s?)?\s+(\w+)/;
const OLD_ID = /\bc\d+\b/g;
const EACH_CREW_WITH_ITS = new RegExp(`\\b(?:each|every) crew with its (?:${[...ONE_THREADS_THINGS, "PRs?", "pull requests?"].join("|")})\\b`, "gi");
const NAME_BEFORE = /(?:\b(?:const|let|var|type|interface|class|function)\s+|\w\??:\s*|<)$/;
const NAME_AFTER = /^(?:\??\.[A-Za-z_]|\[\]|<|\??:\s*\w|\s*=[^=])/;

function scannedFiles(): string[] {
  const inFolders = ["src", "skills"].flatMap((folder) =>
    readdirSync(join(PLUGIN, folder), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(PLUGIN, join(entry.parentPath, entry.name))),
  );
  return [...inFolders, "server.ts"];
}

function misusesIn(file: string): string[] {
  const code = [".ts", ".tsx"].includes(extname(file));
  return readFileSync(join(PLUGIN, file), "utf8")
    .split("\n")
    .flatMap((line, index) => {
      const at = `${file}:${index + 1}`;
      const names = [...line.matchAll(NAME)].flatMap(({ 0: name, index: start }) => {
        const advice = adviceFor(name, line.slice(0, start), line.slice(start + name.length), code && !isComment(line, start));
        return advice === null ? [] : [`${at}  ${name}: ${advice}`];
      });
      const ids = [...line.matchAll(OLD_ID)].map(({ 0: id }) => `${at}  ${id}: an id from before agents. An agent's id is a1, a2…; an issue's is WEB-1, WEB-2….`);
      const possessions = [...line.matchAll(EACH_CREW_WITH_ITS)].map(({ 0: phrase }) => `${at}  "${phrase}": ${ONE_THREAD}`);
      return [...names, ...ids, ...possessions];
    });
}

const ONE_THREAD = `"crew" given one thread's things names one thread. Write "agent" for the thread (agentId, an agent's branch) and "issue" for its work (issueId, its PR); "the crew" is all of a manager's agents.`;

function adviceFor(name: string, before: string, after: string, inCode: boolean): string | null {
  const retired = RETIRED_NAMES.get(/^crew([_-]\w+)$/.exec(name)?.[1] ?? "");
  if (retired !== undefined) return `a retired name for one thread. Write ${retired}.`;
  if (/^crews?ids?$/i.test(name)) return ONE_THREAD;
  const words = name.split(JOINT);
  const crewAt = words.findIndex((word) => /^crews?$/i.test(word));
  if (crewAt === -1) return null;
  const next = words[crewAt + 1] ?? NEXT_WORD.exec(after)?.[1];
  if (next !== undefined && ONE_THREADS_THINGS.includes(next.toLowerCase())) return ONE_THREAD;
  if (/^Crews?$/.test(name) && inCode && (NAME_BEFORE.test(before) || NAME_AFTER.test(after))) {
    return `Crew was one thread's type and is retired. One thread is an Agent and its work an Issue; all of a manager's agents are Agent[].`;
  }
  return null;
}

function isComment(line: string, start: number): boolean {
  return /^\s*(?:\/\/|\/?\*)/.test(line) || line.slice(0, start).includes("//");
}
