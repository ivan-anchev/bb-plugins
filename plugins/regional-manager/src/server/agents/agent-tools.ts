// The regional manager's agent tools: agent_start, agent_message and agent_stop. An agent is one
// child thread holding one issue for its whole life.
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { agentIdSchema, requestedPlacementSchema, startFromSchema, type Agent, type AgentId } from "../../model/agent.ts";
import { requestedExecutionSchema } from "../../model/execution.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { startText, stopText } from "../issues/issue-text.ts";
import type { Store } from "../store/store.ts";
import { failed, forManager, refusedBusy, type ToolsBb } from "../tools/tool-kit.ts";
import type { Agents } from "./agents.ts";

const START = "agent_start";
const MESSAGE = "agent_message";
const STOP = "agent_stop";

/** What configure offers a regional manager of these tools. */
export const AGENT_TOOLS = [START, MESSAGE, STOP];

type Deps = { store: Pick<Store, "roleOfThread" | "agent">; agents: Pick<Agents, "start" | "message" | "stop"> };

export function registerAgentTools(bb: ToolsBb, { store, agents }: Deps): void {
  /** The tool runs on one of the caller's agents; an id it has none by is refused. */
  function forAgent<Input extends { agent: AgentId }>(tool: string, run: (agent: Agent, input: Input) => PluginAgentToolResult | Promise<PluginAgentToolResult>) {
    return forManager<Input>(store, tool, (id, input) => {
      const agent = store.agent(id, input.agent);
      return agent === null ? failed(`You have no agent ${input.agent}. crew_catch_up lists your issues with their agents.`) : run(agent, input);
    });
  }

  bb.agents.registerTool({
    name: START,
    description:
      "Start an agent on one of your issues: a child thread of yours that does the issue's work. Its first message is the issue's description, brief and done-criteria, and CREW.md and MEMORY.md as they are when it starts. The issue needs a brief and its done-criteria first. On an issue that has or had an agent, it is a handover: the agent holding it is stopped (never archived) and replaced, and the new one continues in the previous agent's environment, on its branch, with its commits, its uncommitted files and its pull request. With a placement named, or once bb removed that environment, it moves instead: a new environment, on a new branch cut from the previous agent's, with its commits only; from default starts clean. Its first message adds every earlier handoff and verdict. Returns the agent's id (a1, a2…), a link to its thread, where it works and what it runs on. When the user asked you to propose work and wait, don't call it yet: file the issues in Backlog and ask with crew_ask_user first.",
    presentation: { label: { pending: "Starting an agent", completed: "Started an agent" }, icon: { glyph: "Workflow" } },
    parameters: z.strictObject({
      issue: issueIdSchema.describe("The issue the agent works on, such as i1."),
      from: startFromSchema
        .default("previous")
        .describe(
          "On an issue that had an agent: previous (the default) carries its work on: in its environment, on its branch, or, with a placement named or its environment gone, in a new one on a branch cut from its branch; default starts clean, in a new environment from the default branch. A research issue's agent always starts clean. Ignored on an issue that never had one.",
        ),
      execution: requestedExecutionSchema
        .optional()
        .describe(
          "What the agent runs on: a provider and a model bb can run where it will work, and optionally a reasoning level (left out: the model's default). Left out, it runs on your own provider, model and reasoning level, on a handover too, whatever the previous agent ran on.",
        ),
      placement: requestedPlacementSchema
        .optional()
        .describe(
          'Where a new environment is made: worktree (the default), a fresh worktree on your machine; provider, an environment provider such as boat-sandbox, named by environmentProviderId, with machineInputs for the machine it makes, such as {"preset": "small"} for boat-sandbox (`bb environment providers --json` shows each one\'s machineInputs). A first or clean agent gets its own new branch from the default branch. On a handover, naming one moves the work: the new agent gets its own branch cut from the previous agent\'s, refused while that agent\'s environment holds uncommitted files or can\'t be read; with a sandbox on either side, only once its head is pushed and a pull request shows it. Leave it out to continue where the previous agent worked.',
        ),
    }),
    execute: forManager(store, START, async (id, { issue, from, execution, placement }) => {
      const outcome = await agents.start(id, { issueId: issue, from, execution, placement });
      if ("busy" in outcome) return refusedBusy(START, outcome);
      return outcome.kind === "refused" ? failed(`${START} is refused: ${outcome.reason}`) : startText(issue, outcome);
    }),
  });

  bb.agents.registerTool({
    name: MESSAGE,
    description: "Message one of your agents. It arrives in the agent's thread as a message from you, not from the user: it steers a running turn, or starts a new one.",
    presentation: { label: { pending: "Messaging an agent", completed: "Messaged an agent" }, icon: { glyph: "SideChat" } },
    parameters: z.object({ agent: agentIdSchema, text: z.string().trim().min(1).max(20_000) }),
    execute: forAgent(MESSAGE, async (agent, { text }) => {
      const outcome = await agents.message(agent, text);
      if ("busy" in outcome) return refusedBusy(MESSAGE, outcome);
      switch (outcome.kind) {
        case "sent":
          return `Sent to ${agent.id}.`;
        case "queued":
          return `Queued for ${agent.id}: it is waiting on the user or busy, and gets your message once it is free.`;
        case "already-ended":
          return failed(`${agent.id} was ${outcome.how}, so it takes no more messages. Start a new agent on ${agent.issueId} with agent_start.`);
        case "unbound":
          return failed(`${agent.id} has no thread to message yet: bb hasn't confirmed one.`);
        default:
          return outcome satisfies never;
      }
    }),
  });

  bb.agents.registerTool({
    name: STOP,
    description:
      "Stop one of your agents: its turn stops and it no longer holds its issue. Work it handed off that reached Verifying, In review or Done keeps its issue there; anything short of that returns the issue to Todo. Its thread is kept, unless archive is true.",
    presentation: { label: { pending: "Stopping an agent", completed: "Stopped an agent" }, icon: { glyph: "Check" } },
    parameters: z.object({
      agent: agentIdSchema,
      archive: z
        .boolean()
        .default(false)
        .describe("Archive its thread too, once it is stopped. bb then destroys a sandbox no other thread lives in, unpushed work included, and retires a worktree after a few minutes."),
    }),
    execute: forAgent(STOP, async (agent, { archive }) => {
      const outcome = await agents.stop(agent, archive);
      return "busy" in outcome ? refusedBusy(STOP, outcome) : stopText(agent, outcome);
    }),
  });
}
