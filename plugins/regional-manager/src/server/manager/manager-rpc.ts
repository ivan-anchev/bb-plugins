// A regional manager's record, as the panel changes it: created with its profile and no thread,
// started by the goal sent from its page, its profile edited before and after, and deleted while it
// has no thread. Once it has a thread, its name is that thread's title, which bb keeps, and the store
// keeps the rest (profile.ts).
import { randomUUID } from "node:crypto";
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import type { Spawner } from "../spawn.ts";
import type { Store } from "../store/store.ts";

// The part of bb the record uses, as narrow as the code reads it: an edit renames, and reads nothing back.
type ManagerBb = { sdk: { threads: { update(args: Pick<Parameters<BbPluginApi["sdk"]["threads"]["update"]>[0], "threadId" | "title">): Promise<unknown> } } };

type Deps = {
  bb: ManagerBb;
  store: Pick<Store, "insertCoordinator" | "startOf" | "setProfile" | "removeCoordinator">;
  spawner: Pick<Spawner, "coordinator">;
  /** The list reads every record; a create, an edit or a delete makes it stale. A start's bind refreshes it (server.ts). */
  onChange(): void;
};

type ManagerMethods = Pick<typeof coordinatorContract, "createCoordinator" | "startCoordinator" | "setProfile" | "deleteCoordinator">;

export function managerHandlers({ bb, store, spawner, onChange }: Deps): PluginRpcHandlers<ManagerMethods> {
  // why one operation per regional manager at a time: a double submit of its goal then finds it started and spawns no second thread,
  // and two saves, from two tabs, never land half each, the title of one beside the description of the other.
  const inTurn = turnsByCoordinator();

  function startOf(id: CoordinatorId) {
    const start = store.startOf(id);
    if (start === null) throw new Refusal({ code: "not_found", message: `There is no regional manager ${id}.` });
    return start;
  }

  return {
    createCoordinator: ({ profile }) => {
      const coordinatorId = coordinatorIdSchema.parse(randomUUID());
      store.insertCoordinator({ id: coordinatorId, ticket: randomUUID(), ...profile, createdAt: Date.now() });
      onChange();
      return { coordinatorId };
    },

    startCoordinator: ({ coordinatorId, request }) =>
      inTurn(coordinatorId, async () => {
        const start = startOf(coordinatorId);
        return { threadId: start.kind === "started" ? start.threadId : await spawner.coordinator(coordinatorId, start, request) };
      }),

    // why the title first: a refused rename then writes nothing, so a profile is never half saved.
    setProfile: ({ coordinatorId, profile }) =>
      inTurn(coordinatorId, async () => {
        const start = startOf(coordinatorId);
        if (start.kind === "started") await bb.sdk.threads.update({ threadId: start.threadId, title: profile.name });
        store.setProfile(coordinatorId, profile);
        onChange();
        return {};
      }),

    deleteCoordinator: ({ coordinatorId }) =>
      inTurn(coordinatorId, async () => {
        if (startOf(coordinatorId).kind === "started") throw new Refusal({ code: "conflict", message: "This regional manager has a thread: archive or delete it in bb to remove it." });
        store.removeCoordinator(coordinatorId);
        onChange();
        return {};
      }),
  };
}

/** Runs each regional manager's operations one after another, in the order they were asked for. */
function turnsByCoordinator() {
  const tails = new Map<CoordinatorId, Promise<unknown>>();
  return <T>(id: CoordinatorId, operation: () => Promise<T>): Promise<T> => {
    const run = (tails.get(id) ?? Promise.resolve()).then(operation);
    // why caught: a refused operation must not refuse the ones queued behind it.
    const tail = run.catch(() => {});
    tails.set(id, tail);
    void tail.then(() => tails.get(id) === tail && tails.delete(id));
    return run;
  };
}
