// The New page: the new regional manager's profile and Create, which saves it with no thread and
// opens its page, where the goal sent from bb's composer starts it (manager/manager-page.tsx).
import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useRef, useState, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { NAME_MISSING, NEW_PROFILE_KEY, newDraft, profileDraftSchema, profileOf, randomStart } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { useTakenLooks } from "../profile/use-manager.ts";
import { Button } from "../ui/button.tsx";
import { useStored } from "../ui/stored.ts";

type NewCoordinatorProps = { ref: Ref<HTMLDivElement>; onBack(): void; onCreated(id: CoordinatorId): void };

export function NewCoordinator({ ref, onBack, onCreated }: NewCoordinatorProps) {
  const create = experimental_useRpcMutation({ contract, method: "createCoordinator" });
  // why kept in the browser: what the user typed outlives bb redrawing the panel, until Create saves it.
  const stored = useStored(localStorage, NEW_PROFILE_KEY, profileDraftSchema);
  // why a start kept for the page's life: the look shown doesn't change on each render; until the
  // user types, it moves on only if another manager takes it.
  const [start] = useState(randomStart);
  const taken = useTakenLooks();
  // why null until the managers are read: a look picked before then could be one of theirs, and typing would keep it.
  const draft = stored.value ?? (taken === null ? null : newDraft(start, taken));
  // Whether a create found no name: the field says so from then on, until it has one.
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const profile = draft === null ? null : profileOf(draft);

  async function submit() {
    if (create.isPending) return;
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
          {draft !== null && <ProfileFields value={draft} onChange={stored.store} nameError={tried && profile === null ? NAME_MISSING : null} nameRef={nameRef} />}
          <div className="flex flex-col items-start gap-2">
            {/* why aria-disabled: a disabled button drops focus to the page while the create runs. */}
            <Button type="submit" variant="default" aria-disabled={create.isPending}>
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
