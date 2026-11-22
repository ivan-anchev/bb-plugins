import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";

export function DeleteManager({ coordinatorId, onDeleted }: { coordinatorId: CoordinatorId; onDeleted(): void }) {
  const remove = experimental_useRpcMutation({ contract, method: "deleteCoordinator" });
  const [asking, setAsking] = useState(false);

  function confirm() {
    if (remove.isPending) return;
    remove.mutate({ coordinatorId }).then(onDeleted, () => {});
  }

  if (!asking) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
        <span className="text-destructive-text">Delete</span>
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-2 text-sm">
      {remove.error !== null ? (
        <span role="alert" className="text-destructive-text">
          Could not delete it: {remove.error.message}
        </span>
      ) : (
        <span>Delete it?</span>
      )}
      <Button variant="destructive" size="sm" onClick={confirm} aria-disabled={remove.isPending}>
        {remove.isPending ? "Deleting…" : "Delete"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Keep
      </Button>
    </span>
  );
}
