import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useRef, useState, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { EMPTY_DRAFT, NAME_MISSING, NEW_PROFILE_KEY, profileDraftSchema, profileOf } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { Button } from "../ui/button.tsx";
import { useStored } from "../ui/stored.ts";

type NewCoordinatorProps = { ref: Ref<HTMLDivElement>; onBack(): void; onCreated(id: CoordinatorId): void };

export function NewCoordinator({ ref, onBack, onCreated }: NewCoordinatorProps) {
  const create = experimental_useRpcMutation({ contract, method: "createCoordinator" });
  const stored = useStored(localStorage, NEW_PROFILE_KEY, profileDraftSchema);
  const draft = stored.value ?? EMPTY_DRAFT;
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const profile = profileOf(draft);

  async function submit() {
    if (create.isPending) return;
    if (profile === null) {
      setTried(true);
      nameRef.current?.focus();
      return;
    }
    const created = await create.mutate({ profile }).catch(() => null);
    if (created === null) return;
    stored.store(null);
    onCreated(created.coordinatorId);
  }

  return (
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
          <ProfileFields value={draft} onChange={stored.store} nameError={tried && profile === null ? NAME_MISSING : null} nameRef={nameRef} />
          <div className="flex flex-col items-start gap-2">
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
