// The Board page in the panel: one regional manager's board under its profile, which edits in
// place, with the way back to the list and to its memory.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useCallback, type Ref } from "react";
import type { Profile } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { draftOf, profileDraftSchema, profileEditKeyOf } from "../profile/profile-draft.ts";
import { ProfileEditor } from "../profile/profile-editor.tsx";
import { useProfile } from "../profile/use-profile.ts";
import { AvatarTile } from "../profile/avatar.tsx";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { useStored } from "../ui/stored.ts";
import { Board } from "./board.tsx";

type BoardPageProps = { ref: Ref<HTMLDivElement>; coordinatorId: CoordinatorId; onBack(): void; onOpenMemory(): void };

export function BoardPage({ ref, coordinatorId, onBack, onOpenMemory }: BoardPageProps) {
  const profile = useProfile(coordinatorId);
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
              {profile !== null && edit.value === null && (
                <Button ref={editRef} variant="ghost" size="sm" onClick={() => edit.store(draftOf(profile))}>
                  <Icon name="Edit" aria-hidden />
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onOpenMemory}>
                <Icon name="FileText" aria-hidden />
                Memory
              </Button>
            </div>
          </div>
          {profile !== null && edit.value !== null && (
            <div ref={closing.from} className="px-3">
              <ProfileEditor coordinatorId={coordinatorId} profile={profile} draft={edit.value} onChange={edit.store} onClose={() => edit.store(null)} takeFocus={opening.to} />
            </div>
          )}
          {profile !== null && edit.value === null && <Identity profile={profile} />}
        </header>
        <Board coordinatorId={coordinatorId} />
      </div>
    </div>
  );
}

/** Who this board is of: its avatar, its name as the page's heading, and its description. */
function Identity({ profile: { name, description, avatar } }: { profile: Profile }) {
  return (
    <div className="flex items-start gap-3 px-3">
      <AvatarTile avatar={avatar} size="lg" />
      <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
        <h1 className="text-base font-medium text-pretty [overflow-wrap:anywhere]">
          <span className="sr-only">Board of </span>
          {name}
        </h1>
        {description !== null && <p className="text-sm whitespace-pre-wrap text-pretty text-muted-foreground [overflow-wrap:anywhere]">{description}</p>}
      </div>
    </div>
  );
}
