// What a group of steps did, in bb's chat's words (ThreadScreen bundle: `Wo`
// assembles, `Ao` tallies, `Ro`/`zo` phrase settled/running, `Mo` approvals):
// "Explored 3 files, ran 2 commands" once settled, "Running 2 commands" while live.
import type { WorkRow } from "./bb.ts";
import { plural } from "./roster.ts";
import { isExploration, stepIntents } from "./steps.ts";

/**
 * bb's `Wo`: what a group's work steps did, as an approval sentence ("Waiting for approval on
 * 2 commands") or one phrase per concept in the order each first appears, present tense while live.
 */
export function groupLabel(work: readonly WorkRow[], live: boolean): string {
  return approvalLabel(work) ?? workSentence(work, live);
}

/** What a step counts as in a label (bb's `No`); null for a step that adds no phrase. */
export type Concept = "exploration" | "fileChanges" | "webResearch" | "planUpdates" | CountedConcept;

// why: exhaustive, so a work kind a new SDK adds fails to compile here; at runtime it adds no phrase.
export function conceptOf(row: WorkRow): Concept | null {
  switch (row.workKind) {
    case "command": return isExploration(row) ? "exploration" : "commands";
    case "file-read":
    case "search": return "exploration";
    case "file-change": return "fileChanges";
    case "web-fetch":
    case "web-search": return "webResearch";
    case "plan-steps": return "planUpdates";
    case "tool": return "tools";
    case "delegation": return "delegations";
    case "extension": return "extensions";
    case "image-view": return "imageViews";
    case "image-generation": return "imageGenerations";
    case "approval":
    case "question":
    case "form":
    case "workflow": return null;
    default: return unhandledConcept(row);
  }
}

// ---------------------------------------------------------------- layer 2

/** "Explored 3 files, ran 2 commands": every phrase after the first lowercased (`Bo`). */
function workSentence(work: readonly WorkRow[], live: boolean): string {
  const tally = tallyWork(work);
  const phrases = conceptsInOrder(work).flatMap((concept) => phraseFor(concept, tally, live) ?? []);
  if (phrases.length === 0) return live ? "Working" : "Worked";
  return phrases.map((phrase, i) => (i === 0 ? phrase : phrase.charAt(0).toLowerCase() + phrase.slice(1))).join(", ");
}

/** bb's `Mo`: every step is a command, file change, or tool held at the same approval. */
function approvalLabel(work: readonly WorkRow[]): string | null {
  // why: bb counts in this order (commands, file changes, tools) whatever order the steps came in.
  const counts = { command: 0, "file change": 0, tool: 0 };
  let status: ApprovalStatus | null = null;
  for (const row of work) {
    const held = approvalOf(row);
    if (!held || (status !== null && status !== held.status)) return null;
    status = held.status;
    counts[held.noun]++;
  }
  if (status === null) return null;
  const list = Object.entries(counts).flatMap(([noun, n]) => (n > 0 ? [plural(n, noun)] : [])).join(", ");
  switch (status) {
    case "denied": return `Denied ${list}`;
    case "waiting_for_approval": return `Waiting for approval on ${list}`;
    default: return unhandledApproval(status);
  }
}

type ApprovalStatus = NonNullable<Extract<WorkRow, { workKind: "command" }>["approvalStatus"]>;

/** A command, file change, or tool waiting on, or denied, approval. */
function approvalOf(row: WorkRow): { noun: "command" | "file change" | "tool"; status: ApprovalStatus } | null {
  switch (row.workKind) {
    case "command": return row.approvalStatus && { noun: "command", status: row.approvalStatus };
    case "file-change": return row.approvalStatus && { noun: "file change", status: row.approvalStatus };
    case "tool": return row.approvalStatus && { noun: "tool", status: row.approvalStatus };
    case "file-read":
    case "image-view":
    case "image-generation":
    case "search":
    case "web-search":
    case "web-fetch":
    case "plan-steps":
    case "extension":
    case "form":
    case "approval":
    case "question":
    case "delegation":
    case "workflow": return null;
    default: return unhandledHeld(row);
  }
}

type CountedConcept = keyof typeof COUNTED;

// why: these phrases are a verb and a count of the steps: "Ran 2 commands", "Running 2 commands".
const COUNTED = {
  commands: { running: "Running", ran: "Ran", noun: "command" },
  delegations: { running: "Running", ran: "Ran", noun: "subagent" },
  tools: { running: "Running", ran: "Ran", noun: "tool" },
  extensions: { running: "Running", ran: "Ran", noun: "plugin step" },
  imageViews: { running: "Viewing", ran: "Viewed", noun: "image" },
  imageGenerations: { running: "Generating", ran: "Generated", noun: "image" },
} as const;

function conceptsInOrder(work: readonly WorkRow[]): Concept[] {
  return [...new Set(work.flatMap((row) => conceptOf(row) ?? []))];
}

function phraseFor(concept: Concept, tally: Tally, live: boolean): string | null {
  switch (concept) {
    case "exploration": {
      const list = explorationList(tally.explored);
      return list && `${live ? "Exploring" : "Explored"} ${list}`;
    }
    case "fileChanges": return fileChangePhrase(tally.changed, live);
    case "webResearch": return researchPhrase(tally, live);
    case "planUpdates": return tally.planUpdates > 0 ? (live ? "Updating plan" : `Updated plan ${plural(tally.planUpdates, "time")}`) : null;
    default: {
      const n = tally.counts[concept];
      const words = COUNTED[concept];
      return n > 0 ? `${live ? words.running : words.ran} ${plural(n, words.noun)}` : null;
    }
  }
}

// ---------------------------------------------------------------- layer 3: the tally behind the words (bb's `Ao`)

type Tally = {
  counts: Record<CountedConcept, number>;
  explored: Exploration;
  changed: Record<FileAction, Set<string>>;
  webSearches: number;
  webFetches: number;
  planUpdates: number;
};

/** Unique files, searches, and lists, in the order each kind first appeared. */
type Exploration = { files: Set<string>; searches: number; lists: number; order: ("files" | "searches" | "lists")[] };

type FileAction = "created" | "deleted" | "edited" | "renamed";

function tallyWork(work: readonly WorkRow[]): Tally {
  const tally: Tally = {
    counts: { commands: 0, delegations: 0, tools: 0, extensions: 0, imageViews: 0, imageGenerations: 0 },
    explored: { files: new Set(), searches: 0, lists: 0, order: [] },
    changed: { created: new Set(), deleted: new Set(), edited: new Set(), renamed: new Set() },
    webSearches: 0,
    webFetches: 0,
    planUpdates: 0,
  };
  for (const row of work) {
    switch (row.workKind) {
      case "command":
        if (isExploration(row)) explore(tally.explored, row);
        else tally.counts.commands++;
        break;
      case "file-read":
      case "search": explore(tally.explored, row); break;
      case "file-change": tally.changed[fileAction(row.change)].add(row.change.movePath ?? row.change.path); break;
      case "web-search": tally.webSearches += Math.max(1, row.queries.length); break;
      case "web-fetch": tally.webFetches++; break;
      case "plan-steps": tally.planUpdates++; break;
      case "tool": tally.counts.tools++; break;
      case "delegation": tally.counts.delegations++; break;
      case "extension": tally.counts.extensions++; break;
      case "image-view": tally.counts.imageViews++; break;
      case "image-generation": tally.counts.imageGenerations++; break;
      case "approval":
      case "question":
      case "form":
      case "workflow": break;
      default: row satisfies never; // why: a work kind a newer host adds counts for nothing
    }
  }
  return tally;
}

/** bb's `Oo`: a read adds its file, a list or a search adds one. */
function explore(explored: Exploration, row: WorkRow): void {
  const see = (kind: Exploration["order"][number]) => {
    if (!explored.order.includes(kind)) explored.order.push(kind);
  };
  for (const intent of stepIntents(row)) {
    switch (intent.type) {
      case "read": {
        const file = intent.path ?? intent.name;
        if (file) {
          explored.files.add(file);
          see("files");
        }
        break;
      }
      case "list_files": explored.lists++; see("lists"); break;
      case "search": explored.searches++; see("searches"); break;
      case "unknown": break;
      default: intent satisfies never;
    }
  }
}

/** bb's `jo`: "3 files, 2 searches, 1 list". */
function explorationList(explored: Exploration): string | null {
  const parts = explored.order.map((kind) => {
    switch (kind) {
      case "files": return plural(explored.files.size, "file");
      case "searches": return plural(explored.searches, "search", "searches");
      case "lists": return plural(explored.lists, "list");
      default: return unhandledPart(kind);
    }
  });
  return parts.length > 0 ? parts.join(", ") : null;
}

/** bb's `Lo`: one action names itself ("Created 2 files"); a mix reads as edits. */
function fileChangePhrase(changed: Tally["changed"], live: boolean): string | null {
  const actions = FILE_ACTIONS.filter((action) => changed[action].size > 0);
  if (actions.length === 0) return null;
  if (actions.length === 1) return `${FILE_VERB[actions[0]][live ? 0 : 1]} ${plural(changed[actions[0]].size, "file")}`;
  const total = actions.reduce((sum, action) => sum + changed[action].size, 0);
  return `${live ? "Editing" : "Edited"} ${plural(total, "file")}`;
}

/** bb's `Vo`: "Researched 2 search queries, 1 web page". */
function researchPhrase(tally: Tally, live: boolean): string | null {
  const parts = [
    tally.webSearches > 0 ? plural(tally.webSearches, "search query", "search queries") : null,
    tally.webFetches > 0 ? plural(tally.webFetches, "web page") : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `${live ? "Researching" : "Researched"} ${parts.join(", ")}` : null;
}

const FILE_ACTIONS: readonly FileAction[] = ["created", "deleted", "edited", "renamed"];
const FILE_VERB: Record<FileAction, [running: string, ran: string]> = {
  created: ["Creating", "Created"], deleted: ["Deleting", "Deleted"], edited: ["Editing", "Edited"], renamed: ["Renaming", "Renamed"],
};

type FileChange = Extract<WorkRow, { workKind: "file-change" }>["change"];

/** bb's file-change action: a move is a rename unless lines changed; otherwise its kind decides. */
function fileAction(change: FileChange): FileAction {
  if (change.movePath) return changesLines(change) ? "edited" : "renamed";
  const kind = (change.kind ?? "").toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  if (kind.includes("add") || kind.includes("create")) return "created";
  if (kind.includes("delete") || kind.includes("remove")) return "deleted";
  return "edited";
}

function changesLines(change: FileChange): boolean {
  if (!change.diff) return change.diffStats.added + change.diffStats.removed > 0;
  return change.diff.split("\n").some((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
}

/**
 * `never` keeps these switches exhaustive at compile time. At runtime the bb host can be newer
 * than the pinned SDK: a work kind it adds adds no phrase, and an approval status it adds falls
 * back to the work sentence, so the strip never goes down.
 */
function unhandledConcept(_row: never): Concept | null {
  return null;
}

function unhandledApproval(_status: never): string | null {
  return null;
}

/** A work kind a newer host adds is never held at an approval. */
function unhandledHeld(_row: never): null {
  return null;
}

/** Our own union, so a new kind of exploration is a compile error before it is ever an empty part. */
function unhandledPart(_kind: never): string {
  return "";
}
