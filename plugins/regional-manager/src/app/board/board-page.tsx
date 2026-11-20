// A regional manager's page in the panel, under its profile, which edits in place, with the way back
// to the list: once started, its board, with its memory at the bottom and a way to its thread; until
// then, bb's new-thread composer, whose message is its goal and starts it.
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useCallback, type Ref } from "react";
import type { Profile } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { MemorySection } from "../memory/memory-section.tsx";
import { AvatarTile } from "../profile/avatar.tsx";
import { DeleteManager } from "../profile/delete-manager.tsx";
import { draftOf, profileDraftSchema, profileEditKeyOf } from "../profile/profile-draft.ts";
import { ProfileEditor } from "../profile/profile-editor.tsx";
import { useManager } from "../profile/use-manager.ts";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { useStored } from "../ui/stored.ts";
import { Board } from "./board.tsx";
import { GoalComposer } from "./goal-composer.tsx";

type BoardPageProps = { ref: Ref<HTMLDivElement>; coordinatorId: CoordinatorId; onBack(): void };

export function BoardPage({ ref, coordinatorId, onBack }: BoardPageProps) {
  const manager = useManager(coordinatorId);
  const navigate = useBbNavigate();
  const profile = manager?.profile ?? null;
  // why kept in the browser: an open edit, and what it holds, outlive bb redrawing the panel (stored.ts).
  const edit = useStored(localStorage, profileEditKeyOf(coordinatorId), profileDraftSchema);
  // Edit and the editor take each other's place, so each hands the focus it holds to the other (REVIEW.md).
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
    // why the tab stop: the page scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-3">
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <Icon name="ArrowLeft" aria-hidden />
              All
            </Button>
            <div className="flex items-center gap-1">
              {manager?.kind === "started" && (
                <Button variant="ghost" size="sm" onClick={() => navigate.toThread(manager.threadId)}>
                  Open thread
                </Button>
              )}
              {profile !== null && edit.value === null && (
                <Button ref={editRef} variant="ghost" size="sm" onClick={() => edit.store(draftOf(profile))}>
                  <Icon name="Edit" aria-hidden />
                  Edit
                </Button>
              )}
            </div>
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
                trailing={manager?.kind === "not-started" && <DeleteManager coordinatorId={coordinatorId} onDeleted={deleted} />}
              />
            </div>
          )}
          {profile !== null && edit.value === null && <Identity profile={profile} started={manager?.kind === "started"} />}
        </header>
        {manager?.kind === "started" && (
          <>
            <Board coordinatorId={coordinatorId} />
            <MemorySection coordinatorId={coordinatorId} />
          </>
        )}
        {manager?.kind === "not-started" && <GoalComposer coordinatorId={coordinatorId} name={manager.profile.name} />}
      </div>
    </div>
  );
}

/** Who this page is of: its avatar, its name as the page's heading, and its description. */
function Identity({ profile: { name, description, avatar }, started }: { profile: Profile; started: boolean }) {
  return (
    <div className="flex items-start gap-3 px-3">
      <AvatarTile avatar={avatar} size="lg" />
      <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
        <h1 className="text-base font-medium text-pretty [overflow-wrap:anywhere]">
          {started && <span className="sr-only">Board of </span>}
          {name}
        </h1>
        {description !== null && <p className="text-sm whitespace-pre-wrap text-pretty text-muted-foreground [overflow-wrap:anywhere]">{description}</p>}
      </div>
    </div>
  );
}
