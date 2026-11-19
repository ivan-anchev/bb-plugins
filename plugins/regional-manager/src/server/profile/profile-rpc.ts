// A regional manager's profile, edited after its start: its name is its thread's title, which bb
// keeps, and the store keeps the rest (profile.ts).
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { coordinatorContract } from "../../contract.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";

// The part of bb an edit uses, as narrow as the code reads it: it renames, and reads nothing back.
type ProfileBb = { sdk: { threads: { update(args: Pick<Parameters<BbPluginApi["sdk"]["threads"]["update"]>[0], "threadId" | "title">): Promise<unknown> } } };

type Deps = {
  bb: ProfileBb;
  store: Pick<Store, "coordinator" | "setProfile">;
  /** The list reads the profile; an edit makes it stale. */
  onChange(): void;
};

export function profileHandlers({ bb, store, onChange }: Deps): PluginRpcHandlers<Pick<typeof coordinatorContract, "setProfile">> {
  const inTurn = turnsByCoordinator();
  return {
    // why the title first: a refused rename then writes nothing, so a profile is never half saved.
    // why one edit at a time: two saves, from two tabs, would otherwise each land half, the title of one beside the description of the other.
    setProfile: ({ coordinatorId, profile: { name, ...kept } }) =>
      inTurn(coordinatorId, async () => {
        const coordinator = store.coordinator(coordinatorId);
        if (coordinator === null) throw new Refusal({ code: "not_found", message: `There is no regional manager ${coordinatorId}.` });
        await bb.sdk.threads.update({ threadId: coordinator.threadId, title: name });
        store.setProfile(coordinatorId, kept);
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
    // why caught: a refused edit must not refuse the ones queued behind it.
    const tail = run.catch(() => {});
    tails.set(id, tail);
    void tail.then(() => tails.get(id) === tail && tails.delete(id));
    return run;
  };
}
