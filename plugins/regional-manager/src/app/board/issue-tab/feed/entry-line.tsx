// A machine moment in an issue's feed as one quiet row: what happened, in words, then when. It names
// an agent, or the pull request by its badge as that moment found it, where the moment does, never who did it, since its verb says that
// (only the manager files, edits, starts and stops), nor the status it moved the issue to, which the
// tab's header shows now. A status move no moment explains is a row of its own. Words longer than
// the row are cut, and open on press.
import type { ReactNode } from "react";
import type { Entry } from "../../../../model/feed/entry.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { PR_CHANGE_WORDS } from "../../../../model/verdict/pr.ts";
import type { FiledWhen } from "../../../../model/verdict/rounds/follow-up.ts";
import { PrBadge } from "../../issue/pr-badge.tsx";
import { AgentName, When, type FeedAgents } from "./byline.tsx";
import { Clamp } from "./clamp.tsx";

/** The entries drawn as a row of words: everything but rounds, decisions and comments, which are cards, and a status move alone. */
type LineEntry = Exclude<Entry, { kind: "round" | "decision" | "comment" | "moved" }>;

/** A row's words: `head`, never cut, naming the agent or pull request it is about (null: none), then `text`, cut to the row (null: none). */
type Words = { head: ReactNode; text: string | null };

export function EntryLine({ entry, agents }: { entry: LineEntry; agents: FeedAgents }) {
  return <Line words={wordsOf(entry, agents)} at={entry.at} />;
}

/** A status the issue moved to that no moment explains, as a parent rolling up or a turn ending. */
export function MovedLine({ entry }: { entry: Extract<Entry, { kind: "moved" }> }) {
  return <Line words={{ head: null, text: `Moved to ${STATUS_LABELS[entry.status]}` }} at={entry.at} />;
}

/** why the spaces: a flex row draws its gaps, and screen readers and copied text need words apart. */
function Line({ words, at }: { words: Words; at: number }) {
  return (
    <p className="rmi-line">
      {words.head !== null && <span className="rmi-line-head">{words.head}</span>}{" "}
      {words.text !== null && (
        <Clamp lines={1} className="rmi-line-text">
          {words.text}
        </Clamp>
      )}{" "}
      <When at={at} />
    </p>
  );
}

/** When a follow-up was filed, as the follow-up's own feed says it. */
const FILED_WHEN: Record<FiledWhen, string> = { passed: "when it passed", accepted: "when it was accepted as it was" };

/** What a follow-up holds, as its origin's feed says it. */
const FOLLOW_UP_HOLDS: Record<FiledWhen, string> = {
  passed: "the review findings that held without blocking it",
  accepted: "the review findings it was accepted with, its unfixed must-fixes among them",
};

const said = (text: string): Words => ({ head: null, text });

function wordsOf(entry: LineEntry, agents: FeedAgents): Words {
  switch (entry.kind) {
    case "created":
      return said(entry.followUpOf === null ? "Filed" : `Filed as the follow-up of ${entry.followUpOf.issueId}, ${FILED_WHEN[entry.followUpOf.when]}`);
    case "agent-started":
      return {
        head: (
          <>
            Started <AgentName agentId={entry.agentId} agents={agents} />
          </>
        ),
        text: null,
      };
    case "agent-ended":
      return endedWords(entry, agents);
    case "thread":
      return threadWords(entry, agents);
    case "pr":
      // why PR_CHANGE_WORDS: the manager's doorbell and catch-up name a change in the same words.
      return { head: <PrBadge pr={entry.pr} />, text: entry.changes.flatMap((change) => PR_CHANGE_WORDS[change] ?? []).join(", ") };
    case "follow-up":
      return said(`Follow-up ${entry.issueId} filed in Backlog, with ${FOLLOW_UP_HOLDS[entry.when]}`);
    case "unblocked":
      return said(`Unblocked: ${entry.by}, the last of its dependencies, closed`);
    case "logged":
      return said(loggedText(entry.event));
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      entry satisfies never;
      return { head: null, text: null };
  }
}

/** A change to the issue's plan, by the manager, or where the log began. */
function loggedText(event: Extract<Entry, { kind: "logged" }>["event"]): string {
  switch (event.kind) {
    case "edited":
      // why the fields' own names: they are the words the feed names them by (log-event.ts).
      return `Edited ${event.fields.join(", ")}`;
    case "rested":
      // why a setting, not a move: where it rests shows only while no agent's work or sub-issue places it.
      return `Set to rest in ${STATUS_LABELS[event.rest]}`;
    case "closed":
      return event.as === "canceled" ? "Canceled" : "Accepted as Done";
    case "reopened":
      return "Reopened";
    case "accepted":
      return "Accepted as it is, into In review";
    case "parent-set":
      return event.parentId === null ? "Made top-level" : `Parent set to ${event.parentId}`;
    case "dependency-added":
      return `Now depends on ${event.on}`;
    case "dependency-removed":
      return `No longer depends on ${event.on}`;
    case "log-began":
      return "Edits and status moves are kept from here; verdict times above are as announced or approximate";
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      event satisfies never;
      return "";
  }
}

function endedWords({ agentId, how }: Extract<Entry, { kind: "agent-ended" }>, agents: FeedAgents): Words {
  const agent = <AgentName agentId={agentId} agents={agents} />;
  switch (how) {
    case "stopped":
      return { head: <>Stopped {agent}</>, text: null };
    case "replaced":
      return { head: <>Handed the issue on from {agent}</>, text: null };
    case "archived":
      return { head: <>{agent}'s thread was archived</>, text: null };
    case "deleted":
      return { head: <>{agent}'s thread was deleted</>, text: null };
    case "spawn-failed":
      return { head: <>{agent} never started:</>, text: "bb didn't confirm its thread" };
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      how satisfies never;
      return { head: agent, text: null };
  }
}

/** What an agent's thread said: its own words, which can run long, as the row's text. */
function threadWords({ agentId, event }: Extract<Entry, { kind: "thread" }>, agents: FeedAgents): Words {
  const agent = <AgentName agentId={agentId} agents={agents} />;
  switch (event.kind) {
    case "reported-back":
      return { head: <>{agent} ended its turn with no handoff{event.lastAnswer !== null && ":"}</>, text: event.lastAnswer };
    case "failed":
      return { head: <>{agent} failed{event.error !== null && ":"}</>, text: event.error };
    case "needs-input":
      // why the past: the line is a moment of the issue's history, long after the question was answered.
      return { head: <>{agent} asked a person:</>, text: event.question };
    default:
      // why nothing, not the object: the server may be newer than this bundle for a moment after an update.
      event satisfies never;
      return { head: agent, text: null };
  }
}
