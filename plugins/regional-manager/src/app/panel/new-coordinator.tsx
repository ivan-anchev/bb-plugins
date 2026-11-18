// The New page: the new regional manager's profile, bb's own new-thread composer, seeded with a
// fresh worktree and auto permissions, and the switch for verifying its agents' done handoffs. The
// composer owns the user's choices; the server forwards them, its provider and model marked as
// chosen, titles the thread with the profile's name, and adds the role.
import {
  experimental_Icon as Icon,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  useBbNavigate,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { useRef, useState, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { EMPTY_DRAFT, NAME_MISSING, NEW_PROFILE_KEY, profileDraftSchema, profileOf } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { Button } from "../ui/button.tsx";
import { ReadFailure } from "../ui/read-failure.tsx";
import { useStored } from "../ui/stored.ts";
import { Switch } from "../ui/switch.tsx";
import { composerSeed, type ComposerSeed } from "./composer-seed.ts";

export function NewCoordinator({ ref, onBack }: { ref: Ref<HTMLDivElement>; onBack(): void }) {
  const { seed, host, sidebarFailed } = useComposerSeed();
  const navigate = useBbNavigate();
  const start = experimental_useRpcMutation({ contract, method: "startCoordinator" });
  const [verify, setVerify] = useState(true);
  const stored = useStored(localStorage, NEW_PROFILE_KEY, profileDraftSchema);
  const draft = stored.value ?? EMPTY_DRAFT;
  // Whether a start found no name: the field says so from then on, until it has one.
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const profile = profileOf(draft);

  // The composer keeps the draft when this throws, so a failed start never loses the goal.
  async function submit(request: NewThreadRequest) {
    if (profile === null) {
      setTried(true);
      nameRef.current?.focus();
      throw new Error(NAME_MISSING);
    }
    const { threadId } = await start.mutate({ request, verify, profile });
    stored.store(null);
    navigate.toThread(threadId);
  }

  return (
    // why the tab stop: the page scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex flex-col items-start gap-1">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <Icon name="ArrowLeft" aria-hidden />
            All
          </Button>
          <p className="px-3 text-sm text-muted-foreground">
            Describe the goal. A new regional manager starts in a fresh worktree, reads its memory, and plans the work.
          </p>
        </div>
        <div className="px-3">
          <ProfileFields value={draft} onChange={stored.store} nameError={tried && profile === null ? NAME_MISSING : null} nameRef={nameRef} />
        </div>
        {seed === null && host.error !== null && (
          <ReadFailure onRetry={() => void host.refetch()}>Could not find the machine running bb: {host.error.message}</ReadFailure>
        )}
        {seed === null && sidebarFailed && <ReadFailure>Could not read your projects from bb.</ReadFailure>}
        {seed !== null && (
          <NewThreadComposer
            defaultProjectId={seed.defaultProjectId}
            defaultEnvironment={seed.defaultEnvironment}
            // why auto: a permission prompt on the regional manager would hold everything behind it.
            defaultPermissionMode="auto"
            placeholder="What should this regional manager get done?"
            draftKey="new-coordinator"
            layout="document"
            focusRequest={1}
            onSubmit={submit}
          />
        )}
        <div className="px-3">
          <Switch
            checked={verify}
            onChange={setVerify}
            label="Verify done handoffs"
            hint={
              verify
                ? `When an agent says it's done, a hidden verifier, on another model when there is one, checks each done-criterion before the regional manager hears of it. You can change this on the board.`
                : `Done handoffs reach the regional manager unverified. You can change this on the board.`
            }
          />
        </div>
        {start.error !== null && (
          <p role="alert" className="px-3 text-sm text-destructive-text">
            Could not start it: {start.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The composer's seed, fixed once both reads have succeeded (see composerSeed), plus the reads, so the
 * page can say why there is none yet.
 * why it is fixed once ready: the composer re-seeds every picker when a seed changes, and unmounting
 * it drops them too, so a later read (a project added, the thread list reloading) must not undo what
 * the user picked.
 */
function useComposerSeed() {
  const context = useBbContext();
  const sidebar = useSidebarThreads();
  const host = experimental_useRpcQuery({ contract, method: "primaryHost", input: {} });
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  if (seed === null) {
    const ready = composerSeed(context.projectId, sidebar, host.data);
    if (ready !== null) setSeed(ready);
  }
  return { seed, host, sidebarFailed: sidebar.status === "error" };
}
