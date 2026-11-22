import { randomUUID } from "node:crypto";
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import type { Spawner } from "../spawn.ts";
import type { Store } from "../store/store.ts";

type ManagerBb = { sdk: { threads: { update(args: Pick<Parameters<BbPluginApi["sdk"]["threads"]["update"]>[0], "threadId" | "title">): Promise<unknown> } } };

type Deps = {
  bb: ManagerBb;
  store: Pick<Store, "insertCoordinator" | "startOf" | "setProfile" | "rename" | "removeCoordinator">;
  spawner: Pick<Spawner, "coordinator">;
  /** The list reads every record; a create, an edit or a delete makes it stale. A start's bind refreshes it (server.ts). */
  onChange(): void;
};

type ManagerMethods = Pick<typeof coordinatorContract, "createCoordinator" | "startCoordinator" | "setProfile" | "deleteCoordinator">;

export function managerHandlers({ bb, store, spawner, onChange }: Deps): PluginRpcHandlers<ManagerMethods> {
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

    setProfile: ({ coordinatorId, profile: { name, ...kept } }) =>
      inTurn(coordinatorId, async () => {
        const start = startOf(coordinatorId);
        if (start.kind === "started") await bb.sdk.threads.update({ threadId: start.threadId, title: name });
        else store.rename(coordinatorId, name);
        store.setProfile(coordinatorId, kept);
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

function turnsByCoordinator() {
  const tails = new Map<CoordinatorId, Promise<unknown>>();
  return <T>(id: CoordinatorId, operation: () => Promise<T>): Promise<T> => {
    const run = (tails.get(id) ?? Promise.resolve()).then(operation);
    const tail = run.catch(() => {});
    tails.set(id, tail);
    void tail.then(() => tails.get(id) === tail && tails.delete(id));
    return run;
  };
}
