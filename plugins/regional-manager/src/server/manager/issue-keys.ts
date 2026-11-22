import { issueKeyOf } from "../../model/issue/key/issue-key.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";

type KeysBb = {
  sdk: { projects: { get(args: { projectId: string }): Promise<{ name: string }> } };
  log: { warn(message: string): void };
};

type Deps = { store: Pick<Store, "unkeyedManagers" | "keyIssues">; onChange(id: CoordinatorId): void };

/** One pass of the upgrade. Safe to run while another runs: a manager keys once (keyIssues), so the later write changes nothing. */
export function keyIssuesOfEarlierManagers(bb: KeysBb, { store, onChange }: Deps): () => Promise<void> {
  async function key({ id, projectId }: ReturnType<Store["unkeyedManagers"]>[number]): Promise<void> {
    const { name } = await bb.sdk.projects.get({ projectId });
    if (store.keyIssues(id, issueKeyOf(name))) onChange(id);
  }

  return async () => {
    for (const manager of store.unkeyedManagers()) {
      await key(manager).catch((error: unknown) => bb.log.warn(`Could not key the issues of the regional manager ${manager.id} from its project ${manager.projectId}; the next tick tries again: ${error instanceof Error ? error.message : String(error)}`));
    }
  };
}
