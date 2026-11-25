// A manager card's list: "Needs you", then "In progress", each a group of lines, sub-issues hung under
// their parent. A sub-issue whose parent isn't in its group brings the parent along as a quiet context
// line, so a flagged sub-issue flags itself, never its parent (the Board's rule). Pure.
// The cap: up to nine issues all show, context lines and all; past nine, eight lines show (context
// lines count, as sub-issues do), then how many issues are left out. So never "+1 more".
import type { IssueStatus, ManagerIssues } from "../../../model/manager-issues.ts";

/** The most lines the card shows when issues are left out. */
const MAX_LINES = 8;

/**
 * A line: an issue (`reason`, why it waits on the user, null when it doesn't; `parentId` the parent
 * it hangs under, null for a top-level line; `context` a parent shown only for its sub-issues,
 * quiet), or an open decision naming no listed issue. `last`: a sub-issue line that is its parent's
 * last one shown.
 */
export type IssueLine =
  | { kind: "issue"; id: string; title: string; status: IssueStatus; reason: string | null; parentId: string | null; last: boolean; context: boolean }
  | { kind: "decision"; id: string; question: string };

/** A group: its name, how many issues and decisions it holds, and the lines it shows. */
type IssueGroup = { name: "Needs you" | "In progress"; count: number; lines: readonly IssueLine[] };

/** The groups that show a line, and how many of their issues and decisions are left out ("+N more"). */
export type IssueList = { groups: readonly IssueGroup[]; hidden: number };

/** The card's list; null when the manager has nothing waiting on the user and nothing under way. */
export function issueList(work: ManagerIssues): IssueList | null {
  const known = new Map([...work.parents, ...work.underWay, ...work.needsYou].map((issue) => [issue.id, issue]));
  const groups = ([
    { name: "Needs you", count: work.decisions.length + work.needsYou.length, lines: [...work.decisions.map(decisionLine), ...treeLines(work.needsYou, known)] },
    { name: "In progress", count: work.underWay.length, lines: treeLines(work.underWay.map((issue) => ({ ...issue, reason: null })), known) },
  ] satisfies IssueGroup[]).filter((group) => group.count > 0);
  return groups.length === 0 ? null : capped(groups);
}

// ------------------------------------------------------------------ layer 2

type Member = { id: string; title: string; status: IssueStatus; parentId: string | null; reason: string | null };
type Known = ReadonlyMap<string, { id: string; title: string; status: IssueStatus }>;

const decisionLine = ({ id, question }: ManagerIssues["decisions"][number]): IssueLine => ({ kind: "decision", id, question });

/**
 * A group's members as lines: each top-level one in its place, its sub-issues in the group under it;
 * a sub-issue whose parent isn't in the group under that parent, shown as context where its first
 * sub-issue stands. One whose parent the read doesn't name stands alone.
 */
function treeLines(members: readonly Member[], known: Known): IssueLine[] {
  const inGroup = new Map(members.map((member) => [member.id, member]));
  const rootOf = ({ id, parentId }: Member): string => (parentId !== null && known.has(parentId) ? parentId : id);
  return [...new Set(members.map(rootOf))].flatMap((rootId) => {
    const root = inGroup.get(rootId);
    const kids = members.filter((member) => member.id !== rootId && rootOf(member) === rootId);
    return [root === undefined ? contextLine(known, rootId) : issueLine(root, null), ...kids.map((kid) => issueLine(kid, rootId))];
  });
}

const issueLine = ({ id, title, status, reason }: Member, parentId: string | null): IssueLine => ({ kind: "issue", id, title, status, reason, parentId, last: false, context: false });

/** A parent shown for its sub-issues only. why throw: rootOf heads a sub-issue only with a parent the read names. */
function contextLine(known: Known, id: string): IssueLine {
  const parent = known.get(id);
  if (parent === undefined) throw new Error(`No issue ${id} to head its sub-issues`);
  return { kind: "issue", id, title: parent.title, status: parent.status, reason: null, parentId: null, last: false, context: true };
}

/**
 * Every line when the groups hold at most MAX_LINES + 1 issues and decisions; else MAX_LINES lines,
 * Needs you first, less a context line left with none of its sub-issues, and how many issues and
 * decisions that leaves out. A group with no line left goes, heading and all.
 */
function capped(groups: readonly IssueGroup[]): IssueList {
  const members = groups.reduce((sum, group) => sum + group.count, 0);
  if (members <= MAX_LINES + 1) return { groups: groups.map((group) => ({ ...group, lines: withTrunkEnds(group.lines) })), hidden: 0 };
  let room = MAX_LINES;
  const shown = groups.flatMap((group) => {
    const lines = withoutDanglingContext(group.lines.slice(0, room));
    room -= lines.length;
    return lines.length === 0 ? [] : [{ ...group, lines: withTrunkEnds(lines) }];
  });
  const shownMembers = shown.reduce((sum, group) => sum + group.lines.filter((line) => line.kind === "decision" || !line.context).length, 0);
  return { groups: shown, hidden: members - shownMembers };
}

function withoutDanglingContext(lines: readonly IssueLine[]): readonly IssueLine[] {
  const end = lines.at(-1);
  return end?.kind === "issue" && end.context ? lines.slice(0, -1) : lines;
}

/** Each sub-issue line followed by no other ends its parent's trunk. */
function withTrunkEnds(lines: readonly IssueLine[]): IssueLine[] {
  const isSub = (line: IssueLine | undefined) => line?.kind === "issue" && line.parentId !== null;
  return lines.map((line, i) => (line.kind === "issue" && isSub(line) ? { ...line, last: !isSub(lines[i + 1]) } : line));
}
