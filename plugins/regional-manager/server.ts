// Composition root. Owns no logic: opens the store and the memory folder, and wires each module
// to bb, through the SDK and the store bound to this instance of the plugin (lifetime.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { boardTag, COORDINATORS_TAG, coordinatorContract, memoryTag } from "./src/contract.ts";
import type { CoordinatorId, Role } from "./src/model/role.ts";
import { registerAgentTools } from "./src/server/agents/agent-tools.ts";
import { createAgents } from "./src/server/agents/agents.ts";
import { defaultBranchReader, placementFactsReader } from "./src/server/agents/environments.ts";
import { forwardThreadEvents } from "./src/server/agents/events/thread-events.ts";
import { boardHandlers } from "./src/server/board/board-rpc.ts";
import { createBoard } from "./src/server/board/board.ts";
import { createInbox } from "./src/server/inbox/inbox.ts";
import { releaseHeldManagers } from "./src/server/manager/held-managers.ts";
import { managerHandlers } from "./src/server/manager/manager-rpc.ts";
import { watchOwnTree } from "./src/server/inbox/own-tree-watch.ts";
import { watchAgentThreads } from "./src/server/inbox/thread-watch.ts";
import { registerIssueTools } from "./src/server/issues/issue-tools.ts";
import { issueTurns } from "./src/server/issues/issue-turns.ts";
import { createIssues } from "./src/server/issues/issues.ts";
import { currentViews } from "./src/server/issues/views/current-views.ts";
import { pluginInstance } from "./src/server/lifetime.ts";
import { watchUnblocked } from "./src/server/issues/views/unblocked.ts";
import { openMemoryRoot } from "./src/server/memory/memory-files.ts";
import { memoryHandlers } from "./src/server/memory/memory-rpc.ts";
import { registerRoles } from "./src/server/roles.ts";
import { createSpawner } from "./src/server/spawn.ts";
import { openStore } from "./src/server/store/store.ts";
import { registerCrewTools } from "./src/server/tools/crew-tools.ts";
import { registerHandoffTool } from "./src/server/tools/handoff-tool.ts";
import { createFinalChecks } from "./src/server/verify/final-check/final-checks.ts";
import { registerVerdictTool } from "./src/server/verify/verdict-tool.ts";
import { createVerify } from "./src/server/verify/verify.ts";
import { runGh } from "./src/server/watch/host-command.ts";
import { createPrWatch } from "./src/server/watch/pr-watch.ts";

export default function plugin(host: BbPluginApi): void {
  const instance = pluginInstance(host);
  const { bb } = instance;
  const store = instance.bind(openStore(bb.storage));
  const memory = openMemoryRoot(bb.storage.database().name, store, (id) => bb.rpc.experimental_invalidate([memoryTag(id)]));
  bb.log.info(`Memory files are in ${memory.dir}`);
  const refreshBoard = (id: CoordinatorId) => bb.rpc.experimental_invalidate([boardTag(id)]);
  const refreshCoordinators = () => bb.rpc.experimental_invalidate([COORDINATORS_TAG]);
  // why one hook: whatever changes what a regional manager's views are derived from changes its board, makes a read begun before it stale, and may unblock an issue.
  // A store write is counted by the store as it commits (current-views.ts); views.changed is for what bb moved, a message starting an agent's turn or bb saying a thread moved.
  const onChange = (id: CoordinatorId) => {
    refreshBoard(id);
    views.changed(id);
    unblocked.changed(id);
  };
  // why one hook: deletion and the tick's reconcile both remove a regional manager through it.
  const onRemoved = (id: CoordinatorId) => {
    threadEvents.forget(id);
    refreshCoordinators();
  };
  const spawner = createSpawner(bb, store, memory, (role: Role) => (role.kind === "coordinator" ? refreshCoordinators() : onChange(role.coordinatorId)));
  const board = createBoard(bb, store, memory);
  const inbox = createInbox({ bb, store, memory, onChange });
  const views = currentViews({ bb, store });
  const unblocked = watchUnblocked({ bb, store, views, inbox });
  const turns = issueTurns(instance.signal);
  const prWatch = createPrWatch({ bb, store, inbox, gh: runGh, now: Date.now });
  const agents = createAgents({ bb, store, spawner, inbox, memory, turns, prs: prWatch, placementFacts: placementFactsReader(bb, store), onChange, onRemoved });
  const issues = createIssues({ bb, store, views, onChange });
  const verify = createVerify({ bb, store, spawner, inbox, turns });
  const finalChecks = createFinalChecks({ bb, store, views, turns, verify, defaultBranch: defaultBranchReader(bb, store), now: Date.now });

  const releaseHeld = releaseHeldManagers(bb, store, refreshCoordinators);
  void releaseHeld();

  registerRoles(bb, store);
  registerCrewTools(bb, { store, inbox, memory, board, onChange: refreshBoard });
  registerIssueTools(bb, { store, issues });
  registerAgentTools(bb, { store, agents });
  registerHandoffTool(bb, { store, verify });
  registerVerdictTool(bb, { store, verify });
  const threadEvents = forwardThreadEvents(bb, { store, agents, verify, onChange, refreshBoard });
  watchAgentThreads({ bb, store, inbox });
  watchOwnTree({ bb, store, inbox });
  bb.background.schedule("watch", "* * * * *", async () => {
    // why each caught: a pass that can't read bb or GitHub must not keep the next from running, nor the doorbells from ringing.
    // why the agents first: they remove a regional manager bb deleted before any later pass could ring it.
    // why a 0.3.0 regional manager's upgrade before them: one whose first try failed is tried again (held-managers.ts).
    // why the PR reads before the verifiers: a verdict waiting for CI settles on this tick's read.
    // why the final checks between them: a merge read this tick makes its parent's check this tick, and a check the verifiers' pass then finds busy is the final checks' turn's to start.
    // why nothing waits for the issues' turns the agents' and the verifiers' passes start: a call bb
    // never answers holds only its own issue, which every tick skips until it answers (issue-turns.ts).
    // why what was unblocked after both, and before the ring: a merge read this tick is announced in the same doorbell.
    await releaseHeld();
    await agents.reconcile().catch((error: unknown) => bb.log.warn(`Could not reconcile the agents; the next tick tries again: ${messageOf(error)}`));
    await prWatch.tick(Date.now()).catch((error: unknown) => bb.log.warn(`Could not read the issues' pull requests; the next tick tries again: ${messageOf(error)}`));
    await finalChecks.tick().catch((error: unknown) => bb.log.warn(`Could not read which final checks are due; the next tick tries again: ${messageOf(error)}`));
    await verify.reconcile().catch((error: unknown) => bb.log.warn(`Could not reconcile the verifiers; the next tick tries again: ${messageOf(error)}`));
    await unblocked.tick();
    await inbox.tick(Date.now());
  });

  bb.rpc.register(coordinatorContract, {
    coordinators: () => ({ coordinators: store.coordinators(), notStarted: store.notStarted() }),
    primaryHost: async () => ({ hostId: (await bb.sdk.system.config()).primaryHostId }),
    ...managerHandlers({ bb, store, spawner, onChange: refreshCoordinators }),
    ...boardHandlers({ store, board, inbox }),
    ...memoryHandlers(store, memory, inbox),
  });
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
