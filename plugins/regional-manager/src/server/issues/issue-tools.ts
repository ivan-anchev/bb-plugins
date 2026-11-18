// The regional manager's issue tools: issue_create, issue_update and issue_read. An issue is the
// unit of work; its status is derived from what its agents did, and the manager writes only its plan,
// where it rests, and its two closing acts.
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { requestedExecutionSchema } from "../../model/execution.ts";
import { briefSchema, descriptionSchema, doneCriteriaSchema, issueIdSchema, managerStatusSchema, restSchema, titleSchema, type Issue, type IssueId } from "../../model/issue/issue.ts";
import { kindSchema } from "../../model/issue/kind.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";
import { failed, forManager, type ToolsBb } from "../tools/tool-kit.ts";
import { filedText } from "./issue-text.ts";
import type { Issues } from "./issues.ts";

const CREATE = "issue_create";
const UPDATE = "issue_update";
const READ = "issue_read";

/** What configure offers a regional manager of these tools. */
export const ISSUE_TOOLS = [CREATE, UPDATE, READ];

type Deps = { store: Pick<Store, "roleOfThread" | "issue">; issues: Pick<Issues, "create" | "update" | "read"> };

const VERIFIER = requestedExecutionSchema.describe(
  "What checks this issue's done handoffs: a provider and a model bb can run, and optionally a reasoning level (left out: the model's default). Left out, the plugin picks one independent of the agent.",
);

/** The most issues one issue depends on, or one change adds or removes. */
const MAX_DEPENDENCIES = 20;

const DEPENDS_ON = z
  .array(issueIdSchema)
  .max(MAX_DEPENDENCIES)
  .describe(
    "Issues that must be Done or Canceled before this one is ready, such as [\"i2\"]. It informs and never refuses: an agent can still start on it, and nothing of those issues reaches its agent but what its brief names. A dependency that would close a cycle is refused.",
  );

export function registerIssueTools(bb: ToolsBb, { store, issues }: Deps): void {
  /** The tool runs on one of the caller's issues; an id it has none by is refused. */
  function forIssue<Input extends { id: IssueId }>(tool: string, run: (issue: Issue, input: Input) => PluginAgentToolResult | Promise<PluginAgentToolResult>) {
    return forManager<Input>(store, tool, (id: CoordinatorId, input) => {
      const issue = store.issue(id, input.id);
      return issue === null ? failed(`You have no issue ${input.id}. crew_catch_up lists your issues.`) : run(issue, input);
    });
  }

  bb.agents.registerTool({
    name: CREATE,
    description:
      "File an issue: one piece of the work, done by an agent you start on it with agent_start. It is numbered i1, i2… and rests in Todo, or in Backlog when you are proposing it and waiting for the user. kind decides what its agent hands off and how it is checked: build is code on a branch, verified by an independent verifier; research is a report (a probe, spike, investigation or design) that nothing verifies, Done as its agent hands it off. A brief, and a build issue's doneCriteria, may wait until you start its agent.",
    presentation: { label: { pending: "Filing an issue", completed: "Filed an issue" }, icon: { glyph: "Workflow" } },
    parameters: z.strictObject({
      kind: kindSchema.describe(
        "build: code on its own branch, checked by a verifier against the done-criteria. research: a report saved in your memory as reports/<issue id>.md; its doneCriteria are the questions it answers, and nobody judges them. It can't change once an agent has started.",
      ),
      title: titleSchema.describe("A short name for the piece of work; it titles its agent's thread."),
      description: descriptionSchema.describe("What it is about, in plain words, for the user: the board shows it."),
      brief: briefSchema.optional().describe("Everything its agent needs to start without asking: the goal, the context, the constraints, where to look. Required before an agent starts."),
      doneCriteria: doneCriteriaSchema
        .optional()
        .describe(
          "Up to 12. A build issue's: each checkable by running something (a test, a command and its output, a page that shows a thing), at least one before an agent starts. A research issue's: the questions its report answers, none or more.",
        ),
      status: restSchema.optional().describe("todo (the default): ready to start. backlog: not planned yet, as when you propose it and wait for the user."),
      verifier: VERIFIER.optional().describe(`${VERIFIER.description} A research issue has none.`),
      dependsOn: DEPENDS_ON.optional(),
    }),
    execute: forManager(store, CREATE, async (id, { brief, doneCriteria, status, dependsOn, ...plan }) => {
      const filed = await issues.create(id, { ...plan, brief: brief ?? null, doneCriteria: doneCriteria ?? [], rest: status ?? "todo", dependsOn: dependsOn ?? [] });
      return "refused" in filed ? failed(filed.refused) : filedText(filed.issue, filed.blockedBy);
    }),
  });

  bb.agents.registerTool({
    name: UPDATE,
    description:
      "Change one of your issues: its kind (only before any agent has started on it), title, description, brief, done-criteria, verifier or dependencies (dependsOn: add and remove), or where it stands. status: backlog or todo rests an issue no agent holds (and reopens a canceled one); canceled closes one no agent holds; done accepts one that is In review (a research issue never is: its agent's done handoff makes it Done). Every other status is the plugin's to say, from what its agents did. A build issue's verifier change applies from its next done handoff on; verifier: null lets the plugin pick again, and drops the one named when the issue becomes research. A status or dependency change that makes issues ready says so: \"Now ready: i3\".",
    presentation: { label: { pending: "Updating an issue", completed: "Updated an issue" }, icon: { glyph: "Workflow" } },
    parameters: z.strictObject({
      id: issueIdSchema,
      kind: kindSchema.optional(),
      title: titleSchema.optional(),
      description: descriptionSchema.optional(),
      brief: briefSchema.optional(),
      doneCriteria: doneCriteriaSchema.optional(),
      status: managerStatusSchema.optional(),
      verifier: VERIFIER.nullable().optional(),
      dependsOn: z
        .strictObject({ add: DEPENDS_ON.default([]), remove: z.array(issueIdSchema).max(MAX_DEPENDENCIES).default([]).describe("Issues it no longer depends on.") })
        .optional()
        .describe("Change what it depends on: add issues to wait for, remove ones it no longer waits for."),
    }),
    execute: forIssue(UPDATE, async (issue, { id: _, ...change }) => {
      const updated = await issues.update(issue, change);
      if ("refused" in updated) return failed(updated.refused);
      const ready = updated.nowReady.length === 0 ? null : `Now ready: ${updated.nowReady.join(", ")}.`;
      return [`Updated ${issue.id}.`, updated.note, ready].filter((line) => line !== null).join(" ");
    }),
  });

  bb.agents.registerTool({
    name: READ,
    description:
      "Read one of your issues whole: its status and why, what blocks it, its description, brief and done-criteria, what it depends on and what it blocks, the verifier named, each agent with what it runs on, every handoff with its verdict, and its agent's latest answer.",
    presentation: { label: { pending: "Reading an issue", completed: "Read an issue" }, icon: { glyph: "FileText" } },
    parameters: z.object({ id: issueIdSchema }),
    execute: forIssue(READ, (issue) => issues.read(issue)),
  });
}
