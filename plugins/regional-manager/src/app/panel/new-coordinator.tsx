// The New page: the new regional manager's profile, where it works (a project in a fresh worktree
// from a branch, the project's checkout, or no project), what it runs on (bb's provider and model
// picker and its permission-mode picker), the switch for verifying its agents' done handoffs, and
// Create. It has no prompt: Create opens the new thread, which waits for the goal the user types
// there (goal.ts). The server titles the thread with the profile's name and adds the role.
import {
  experimental_BranchPicker as BranchPicker,
  experimental_Icon as Icon,
  experimental_PermissionModePicker as PermissionModePicker,
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { useId, useRef, useState, type ReactNode, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { EMPTY_DRAFT, NAME_MISSING, NEW_PROFILE_KEY, profileDraftSchema, profileOf } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { Button } from "../ui/button.tsx";
import { ReadFailure } from "../ui/read-failure.tsx";
import { useStored } from "../ui/stored.ts";
import { Switch } from "../ui/switch.tsx";
import { createStart, requestOf, type CreateChoices, type CreateStart, type Place } from "./create-form.ts";

const PLACES: readonly { place: Place; label: string }[] = [
  { place: "worktree", label: "New worktree" },
  { place: "checkout", label: "Project checkout" },
  { place: "personal", label: "No project" },
];

// why these: the profile's name field, so the form reads as one.
const SELECT_FIELD =
  "w-full min-w-0 cursor-pointer rounded-md border border-input bg-transparent px-2.5 py-1.5 text-base leading-6 text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 sm:text-sm sm:leading-5";

export function NewCoordinator({ ref, onBack }: { ref: Ref<HTMLDivElement>; onBack(): void }) {
  const { start, seed, sidebarFailed } = useCreateStart();
  return (
    // why the tab stop: the page scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div ref={ref} tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col items-start gap-1">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <Icon name="ArrowLeft" aria-hidden />
            All
          </Button>
          <p className="px-3 text-sm text-muted-foreground">Create a regional manager, then type its goal in its thread. It reads its memory, and plans the work.</p>
        </div>
        {start === null && seed.error !== null && <ReadFailure onRetry={() => void seed.refetch()}>Could not read where bb runs: {seed.error.message}</ReadFailure>}
        {start === null && sidebarFailed && <ReadFailure>Could not read your projects from bb.</ReadFailure>}
        {start !== null && "missing" in start && <p className="px-3 text-sm text-muted-foreground">{start.missing}</p>}
        {start !== null && !("missing" in start) && <CreateForm start={start} />}
      </div>
    </div>
  );
}

function CreateForm({ start }: { start: CreateStart }) {
  const navigate = useBbNavigate();
  const create = experimental_useRpcMutation({ contract, method: "startCoordinator" });
  const [choices, setChoices] = useState(start.choices);
  const [verify, setVerify] = useState(true);
  const stored = useStored(localStorage, NEW_PROFILE_KEY, profileDraftSchema);
  const draft = stored.value ?? EMPTY_DRAFT;
  // Whether a create found no name: the field says so from then on, until it has one.
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const profile = profileOf(draft);
  const ids = useId();
  const routing = start.hostId === null ? undefined : { kind: "host" as const, hostId: start.hostId };
  const choose = (next: Partial<CreateChoices>) => setChoices((current) => ({ ...current, ...next }));

  async function submit() {
    if (create.isPending) return;
    if (profile === null) {
      setTried(true);
      nameRef.current?.focus();
      return;
    }
    // why caught: the page shows the refusal under Create, and keeps every choice to try again.
    const started = await create.mutate({ request: requestOf(choices, start), verify, profile }).catch(() => null);
    if (started === null) return;
    stored.store(null);
    navigate.toThread(started.threadId);
  }

  return (
    <div className="flex flex-col gap-5 px-3">
      <ProfileFields value={draft} onChange={stored.store} nameError={tried && profile === null ? NAME_MISSING : null} nameRef={nameRef} />
      <Field label="Works in" labelId={`${ids}-place`}>
        {/* why radios: one place at a time, and the arrow keys move between them as in any radio group. */}
        <div role="radiogroup" aria-labelledby={`${ids}-place`} className="flex flex-wrap gap-1">
          {PLACES.filter(({ place }) => place !== "personal" || start.personalProjectId !== null).map(({ place, label }) => (
            <label key={place} className="cursor-pointer">
              <input type="radio" name={`${ids}-place`} checked={choices.place === place} onChange={() => choose({ place })} className="peer sr-only" />
              <span className="flex h-8 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 peer-checked:bg-secondary peer-checked:text-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-ring">
                {label}
              </span>
            </label>
          ))}
        </div>
      </Field>
      {choices.place !== "personal" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Project" labelId={`${ids}-project`}>
            <select aria-labelledby={`${ids}-project`} value={choices.projectId} onChange={(event) => choose({ projectId: event.target.value, baseBranch: null })} className={SELECT_FIELD}>
              {start.projects.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          {choices.place === "worktree" && (
            <div className="shrink-0">
              <BranchPicker hostId={start.hostId} projectId={choices.projectId} value={choices.baseBranch} onChange={(baseBranch) => choose({ baseBranch })} label="From:" placeholder="Default branch" />
            </div>
          )}
        </div>
      )}
      <Field label="Runs on" labelId={`${ids}-runs`}>
        <div role="group" aria-labelledby={`${ids}-runs`} className="flex flex-wrap items-center gap-2">
          <ProviderModelPicker value={choices.execution} onChange={(execution) => choose({ execution })} routing={routing} />
          <PermissionModePicker providerId={choices.execution.providerId} value={choices.permissionMode} onChange={(permissionMode) => choose({ permissionMode })} routing={routing} align="start" />
        </div>
      </Field>
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
      <div className="flex flex-col items-start gap-2">
        {/* why aria-disabled: a disabled button drops focus to the page while the create runs. */}
        <Button variant="default" onClick={() => void submit()} aria-disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create"}
        </Button>
        {create.error !== null && (
          <p role="alert" className="text-sm text-destructive-text">
            Could not create it: {create.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, labelId, children }: { label: string; labelId: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * What the form starts from, fixed once both reads have succeeded (see createStart), plus the reads,
 * so the page can say why there is none yet. why fixed once ready: a later read (a project added, the
 * thread list reloading) must not undo what the user picked.
 */
function useCreateStart() {
  const context = useBbContext();
  const sidebar = useSidebarThreads();
  const seed = experimental_useRpcQuery({ contract, method: "newSeed", input: {} });
  const [start, setStart] = useState<ReturnType<typeof createStart>>(null);
  if (start === null) {
    const ready = createStart(context.projectId, sidebar, seed.data);
    if (ready !== null) setStart(ready);
  }
  return { start, seed, sidebarFailed: sidebar.status === "error" };
}
