// A question waiting for the user that names no issue, under Needs you: one the regional manager
// asked before every question had to name an issue, so no issue's feed holds it. Its row has the
// manager's avatar in the 30 slot and the question across the id and title columns, up to two
// lines; pressing it opens the manager's thread, where the user tells it their answer. It leaves the
// board once answered.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { Ref } from "react";
import type { UnfiledQuestion } from "../../../model/board/board-groups.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { AvatarBlob } from "../../profile/avatar.tsx";
import { useManager } from "../../profile/use-manager.ts";

type UnfiledQuestionRowProps = { ref: Ref<HTMLButtonElement>; coordinatorId: CoordinatorId; decision: UnfiledQuestion };

export function UnfiledQuestionRow({ ref, coordinatorId, decision }: UnfiledQuestionRowProps) {
  const navigate = useBbNavigate();
  const manager = useManager(coordinatorId);
  const profile = manager?.profile ?? null;
  // why possibly none: the plugin's read of its managers may not have answered yet.
  const threadId = manager?.kind === "started" ? manager.threadId : null;
  return (
    <div className="rmi-rowbox" data-asks>
      <button
        ref={ref}
        type="button"
        className="rmi-row"
        aria-label={`${profile?.name ?? "The regional manager"} asks you, on no issue: ${decision.question}`}
        onClick={() => {
          if (threadId !== null) navigate.toThread(threadId);
        }}
      >
        <span className="rmi-slot">{profile !== null && <AvatarBlob avatar={profile.avatar} size="xs" />}</span>
        <span className="rmi-unfiled-question">{decision.question}</span>
      </button>
    </div>
  );
}
