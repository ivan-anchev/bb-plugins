// What an issue's log holds (migrations.ts issue_log): what has no other home. Its plan's changes,
// written by the store's one plan writer as it applies them (issues-store.ts updateIssue); each
// status the plugin observed the issue move to, as the views read after every change and on the
// tick say (view-watch.ts); and, for an issue filed before the log, where it began.
import { z } from "zod";
import { closedAsSchema, issueIdSchema, restSchema, type Issue, type IssueId } from "../issue/issue.ts";
import { issueStatusSchema, type IssueStatus, type IssueView } from "../issue/status.ts";

/** The plan's fields an edit names, as the feed names them. */
const editedFieldSchema = z.enum(["kind", "title", "description", "brief", "criteria", "verifier"]);
export type EditedField = z.infer<typeof editedFieldSchema>;

/** What the feed shows of a log as a line of its own: every kind but a status, which it shows on a moment (feed.ts attachStatuses). */
const LINE_EVENTS = [
  z.object({ kind: z.literal("edited"), fields: z.array(editedFieldSchema).min(1) }),
  z.object({ kind: z.literal("rested"), rest: restSchema }),
  z.object({ kind: z.literal("closed"), as: closedAsSchema }),
  z.object({ kind: z.literal("reopened") }),
  /** Made a sub-issue of `parentId`, or top-level (null). */
  z.object({ kind: z.literal("parent-set"), parentId: issueIdSchema.nullable() }),
  z.object({ kind: z.literal("dependency-added"), on: issueIdSchema }),
  z.object({ kind: z.literal("dependency-removed"), on: issueIdSchema }),
  /** The log began here: an issue filed before it has nothing earlier. */
  z.object({ kind: z.literal("log-began") }),
] as const;

export const lineEventSchema = z.discriminatedUnion("kind", LINE_EVENTS);

export const logEventSchema = z.discriminatedUnion("kind", [
  ...LINE_EVENTS,
  /** The plugin observed the issue's status move to `status`: never derived from the other rows, only seen. */
  z.object({ kind: z.literal("status"), status: issueStatusSchema }),
]);
export type LogEvent = z.infer<typeof logEventSchema>;

/** A row of an issue's log: what happened, and when. */
export type Logged = { at: number; event: LogEvent };

/**
 * What an edit changed of the issue's plan, `was` as stored and `now` as it will be, in a fixed
 * order: the fields edited, where it rests, its close or reopening, its parent, then each dependency
 * added and removed. Nothing for an edit that changes nothing. A dependency moved in the list is
 * neither added nor removed.
 */
export function planChanges(was: Issue, now: Issue): LogEvent[] {
  const fields = EDITED.filter(([, changed]) => changed(was, now)).map(([field]) => field);
  return [
    ...(fields.length > 0 ? [{ kind: "edited", fields } as const] : []),
    ...(was.rest !== now.rest ? [{ kind: "rested", rest: now.rest } as const] : []),
    ...closeChanges(was.closed, now.closed),
    ...(was.parentId !== now.parentId ? [{ kind: "parent-set", parentId: now.parentId } as const] : []),
    ...now.dependsOn.filter((id) => !was.dependsOn.includes(id)).map((on) => ({ kind: "dependency-added", on }) as const),
    ...was.dependsOn.filter((id) => !now.dependsOn.includes(id)).map((on) => ({ kind: "dependency-removed", on }) as const),
  ];
}

/** Each issue whose status in `views` is not the last one logged for it (`last`; absent: none logged yet), with that status. */
export function statusMoves(last: ReadonlyMap<IssueId, IssueStatus>, views: readonly Pick<IssueView, "issue" | "status">[]): { issueId: IssueId; status: IssueStatus }[] {
  return views.filter(({ issue, status }) => last.get(issue.id) !== status).map(({ issue, status }) => ({ issueId: issue.id, status }));
}

/** Each field the feed names, and whether an edit changed it. why JSON for the criteria and verifier: they are compared whole, as they are stored. */
const EDITED: readonly (readonly [EditedField, (was: Issue, now: Issue) => boolean])[] = [
  ["kind", (was, now) => was.kind !== now.kind],
  ["title", (was, now) => was.title !== now.title],
  ["description", (was, now) => was.description !== now.description],
  ["brief", (was, now) => was.brief !== now.brief],
  ["criteria", (was, now) => JSON.stringify(was.doneCriteria) !== JSON.stringify(now.doneCriteria)],
  ["verifier", (was, now) => JSON.stringify(was.verifier) !== JSON.stringify(now.verifier)],
];

/** A close (a new one, or closed again another way or at another time), or a reopening. */
function closeChanges(was: Issue["closed"], now: Issue["closed"]): LogEvent[] {
  if (now === null) return was === null ? [] : [{ kind: "reopened" }];
  return was !== null && was.as === now.as && was.at === now.at ? [] : [{ kind: "closed", as: now.as }];
}
