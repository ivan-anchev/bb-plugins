import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, type Ref } from "react";
import type { Profile } from "../../../model/profile.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { AvatarTile } from "../../profile/avatar.tsx";
import { DeleteManager } from "../../profile/delete-manager.tsx";
import { draftOf, profileDraftSchema, profileEditKeyOf } from "../../profile/profile-draft.ts";
import { ProfileEditor } from "../../profile/profile-editor.tsx";
import { useManager } from "../../profile/use-manager.ts";
import { Button } from "../../ui/button.tsx";
import { useFocusHandOff } from "../../ui/focus-hand-off.ts";
import { useStored } from "../../ui/stored.ts";
import { GoalComposer } from "./goal-composer.tsx";

type ManagerPageProps = { ref: Ref<HTMLDivElement>; coordinatorId: CoordinatorId; onBack(): void };

export function ManagerPage({ ref, coordinatorId, onBack }: ManagerPageProps) {
  const manager = useManager(coordinatorId);
  const profile = manager?.kind === "not-started" ? manager.profile : null;
  const openThread = useOpenThreadOnce();
  const threadId = manager?.kind === "started" ? manager.threadId : null;
  useEffect(() => {
    if (threadId !== null) openThread(threadId);
  }, [threadId, openThread]);
  const edit = useStored(localStorage, profileEditKeyOf(coordinatorId), profileDraftSchema);
  const opening = useFocusHandOff();
  const closing = useFocusHandOff();
  const editRef = useCallback(
    (button: HTMLButtonElement | null) => {
      closing.to(button);
      return opening.from(button);
    },
    [opening, closing],
  );

  function deleted() {
    edit.store(null);
    onBack();
  }

  return (
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-3">
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <Icon name="ArrowLeft" aria-hidden />
              All
            </Button>
            {profile !== null && edit.value === null && (
              <Button ref={editRef} variant="ghost" size="sm" onClick={() => edit.store(draftOf(profile))}>
                <Icon name="Edit" aria-hidden />
                Edit
              </Button>
            )}
          </div>
          {profile !== null && edit.value !== null && (
            <div ref={closing.from} className="px-3">
              <ProfileEditor
                coordinatorId={coordinatorId}
                profile={profile}
                draft={edit.value}
                onChange={edit.store}
                onClose={() => edit.store(null)}
                takeFocus={opening.to}
                trailing={<DeleteManager coordinatorId={coordinatorId} onDeleted={deleted} />}
              />
            </div>
          )}
          {profile !== null && edit.value === null && <Identity profile={profile} />}
        </header>
        {profile !== null && <GoalComposer coordinatorId={coordinatorId} name={profile.name} onStarted={openThread} />}
      </div>
    </div>
  );
}

function useOpenThreadOnce(): (threadId: string) => void {
  const navigate = useBbNavigate();
  const opened = useRef<string | null>(null);
  return useCallback(
    (threadId) => {
      if (opened.current === threadId) return;
      opened.current = threadId;
      navigate.toThread(threadId);
    },
    [navigate],
  );
}

function Identity({ profile: { name, description, avatar } }: { profile: Profile }) {
  return (
    <div className="flex items-start gap-3 px-3">
      <AvatarTile avatar={avatar} size="lg" />
      <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
        <h1 className="text-base font-medium text-pretty [overflow-wrap:anywhere]">{name}</h1>
        {description !== null && <p className="text-sm whitespace-pre-wrap text-pretty text-muted-foreground [overflow-wrap:anywhere]">{description}</p>}
      </div>
    </div>
  );
}
