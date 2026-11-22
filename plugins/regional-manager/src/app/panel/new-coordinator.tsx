// The New page: the new regional manager's profile and Create, which saves it with no thread and
// opens its page, where the goal sent from bb's composer starts it (manager/manager-page.tsx).
import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useRef, useState, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { randomStart } from "../../model/profile/avatar.ts";
import { NAME_MISSING, NEW_PROFILE_KEY, newDraft, profileOf, storedDraftSchema, withLook, type ProfileDraft, type StoredDraft } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { useTakenLooks } from "../profile/use-manager.ts";
import { Button } from "../ui/button.tsx";
import { ReadFailure } from "../ui/read-failure.tsx";
import { useStored } from "../ui/stored.ts";

type NewCoordinatorProps = { ref: Ref<HTMLDivElement>; onBack(): void; onCreated(id: CoordinatorId): void };

export function NewCoordinator({ ref, onBack, onCreated }: NewCoordinatorProps) {
  const create = experimental_useRpcMutation({ contract, method: "createCoordinator" });
  // why kept in the browser: what the user typed outlives bb redrawing the panel, until Create saves it.
  const stored = useStored(localStorage, NEW_PROFILE_KEY, storedDraftSchema);
  const taken = useTakenLooks();
  // A new manager's fields, with the first look from `start` none of the others has in the list read
  // last, so the look moves on only once a read shows it taken, and a later failed read keeps the
  // fields; none before the first read, when a look picked could be theirs.
  const [start] = useState(randomStart);
  const draft = shownDraft(stored.value, taken.lastRead === null ? null : newDraft(start, taken.lastRead));
  // Whether a create found no name: the field says so from then on, until it has one.
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const profile = draft === null ? null : profileOf(draft);

  async function submit() {
    // why draft null too: there are no fields to create from until the other managers are read.
    if (create.isPending || draft === null) return;
    if (profile === null) {
      setTried(true);
      nameRef.current?.focus();
      return;
    }
    // why caught: the page shows the refusal under Create, and keeps the fields to try again.
    const created = await create.mutate({ profile }).catch(() => null);
    if (created === null) return;
    stored.store(null);
    onCreated(created.coordinatorId);
  }

  return (
    // why the tab stop: the page scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <form
        aria-labelledby="new-coordinator-heading"
        className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col items-start gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <Icon name="ArrowLeft" aria-hidden />
            All
          </Button>
          <h1 id="new-coordinator-heading" className="px-3 text-base font-medium">
            New regional manager
          </h1>
        </div>
        <div className="flex flex-col gap-5 px-3">
          {draft === null && taken.error !== null && (
            <ReadFailure onRetry={taken.retry}>Could not read the other regional managers, so a new one can't be given a look of its own yet: {taken.error.message}</ReadFailure>
          )}
          {draft !== null && <ProfileFields value={draft} onChange={(next) => stored.store(keptOf(next, draft, stored.value))} nameError={tried && profile === null ? NAME_MISSING : null} nameRef={nameRef} />}
          <div className="flex flex-col items-start gap-2">
            {/* why aria-disabled: a disabled button drops focus to the page while the create runs, or until there are fields to create from. */}
            <Button type="submit" variant="default" aria-disabled={create.isPending || draft === null}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
            {create.error !== null && (
              <p role="alert" className="text-sm text-destructive-text">
                Could not create it: {create.error.message}
              </p>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * The fields the page shows: the ones the browser kept, given `fresh`'s look when theirs can't be
 * read, or else `fresh`; null while a look is needed and none is known yet.
 */
function shownDraft(kept: StoredDraft | null, fresh: ProfileDraft | null): ProfileDraft | null {
  if (kept === null) return fresh;
  if (kept.avatar !== null) return withLook(kept, kept.avatar);
  return fresh === null ? null : withLook(kept, fresh.avatar);
}

/**
 * The fields to keep in the browser: what was typed, and the avatar only once the user picked one
 * (Shuffle, a shape or a colour). why: a look the page gave keeps following the reads (shownDraft),
 * so typing a name never fixes a look a later read shows taken.
 */
function keptOf(next: ProfileDraft, shown: ProfileDraft, before: StoredDraft | null): StoredDraft {
  // why by value: a pick always changes the look (the checked radio fires nothing, and Shuffle never returns the look it had).
  const picked = JSON.stringify(next.avatar) !== JSON.stringify(shown.avatar);
  return { ...next, avatar: picked ? next.avatar : (before?.avatar ?? null) };
}
