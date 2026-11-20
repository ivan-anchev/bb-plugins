// PROTOTYPE (i7), throwaway: the pieces the create-first variants share.
import {
  experimental_Icon as Icon,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useRpcQuery,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract } from "../../contract.ts";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AVATAR_ICON_LABELS, AVATAR_ICONS, DESCRIPTION_MAX, type Avatar, type Profile } from "../../model/profile.ts";
import { draftOf, NAME_MISSING, profileOf, type ProfileDraft } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { Button } from "../ui/button.tsx";

/** A page of the panel: the scroller and its centred column, as every real page has. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 pb-24 sm:px-6">{children}</div>
    </div>
  );
}

export function BackToAll({ onBack }: { onBack(): void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <Icon name="ArrowLeft" aria-hidden />
      All
    </Button>
  );
}

/** The icons, one at a time as radios, ProfileFields' own picker on its own. */
export function IconGrid({ value, onChange }: { value: Avatar; onChange(next: Avatar): void }) {
  const ids = useId();
  return (
    <fieldset className="flex flex-wrap gap-1">
      <legend className="sr-only">Icon</legend>
      {AVATAR_ICONS.map((icon) => (
        <label key={icon} className="cursor-pointer">
          <input type="radio" name={`${ids}-icon`} aria-label={AVATAR_ICON_LABELS[icon]} checked={value.icon === icon} onChange={() => onChange({ kind: "icon", icon })} className="peer sr-only" />
          <span className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 peer-checked:bg-secondary peer-checked:text-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-ring [&_[data-icon-root]]:size-4">
            <Icon name={icon} aria-hidden />
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Not started: Activity Sidebar's pending ring, dotted as the board's Backlog draws it. */
export function NotStartedGlyph({ label = "Not started" }: { label?: string }) {
  return (
    <span className="rmp-state" role="img" aria-label={label}>
      <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="9" strokeWidth={2.25} strokeDasharray="0.01 4.71" />
      </svg>
    </span>
  );
}

/** A manager's avatar at any size; `lg` is the board's, `xl` a page that leads with it. */
export function AvatarIcon({ avatar, size }: { avatar: Avatar; size: "sm" | "lg" | "xl" }) {
  const box = { sm: "size-7 rounded-md [&_[data-icon-root]]:size-4", lg: "size-10 rounded-lg [&_[data-icon-root]]:size-5", xl: "size-14 rounded-xl [&_[data-icon-root]]:size-7" }[size];
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center bg-muted text-foreground ${box}`}>
      <Icon name={avatar.icon} />
    </span>
  );
}

/**
 * bb's new-thread composer as i6 would mount it on a threadless manager's page. Sending only says
 * what i6 would do: the prototype spawns no thread.
 */
export function GoalComposer({ name, draftKey, onSent }: { name: string; draftKey: string; onSent(): void }) {
  // As 0.2.0 seeded it (composer-seed.ts): the first project, a fresh worktree on bb's machine.
  const sidebar = useSidebarThreads();
  const seed = experimental_useRpcQuery({ contract, method: "newSeed", input: {} });
  if (sidebar.status !== "ready" || seed.data === undefined) return <div className="h-[118px]" aria-hidden />;
  const hostId = seed.data.hostId;
  return (
    <NewThreadComposer
      defaultProjectId={sidebar.projects.find((project) => !project.isPersonal)?.id}
      defaultEnvironment={hostId === null ? undefined : { type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }}
      // why auto: a permission prompt on the regional manager would hold everything behind it.
      defaultPermissionMode="auto"
      placeholder={`What should ${name} get done?`}
      draftKey={`proto-i7-${draftKey}`}
      layout="document"
      onSubmit={async () => onSent()}
    />
  );
}

/** What a sent goal would do in i6, said where the composer was. */
export function SentNotice({ name, onReset }: { name: string; onReset(): void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 rounded-lg bg-surface-recessed px-3 py-2.5 text-sm text-muted-foreground">
      <span>Prototype: i6 starts {name}'s thread with this goal and opens it.</span>
      <Button variant="ghost" size="sm" onClick={onReset}>
        Back
      </Button>
    </div>
  );
}

/** Edit as a dialog: bb's dialog surface over the page, the profile's fields, Save and Cancel. */
export function EditDialog({ open, profile, onSave, onClose }: { open: boolean; profile: Profile; onSave(next: Profile): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ProfileDraft>(draftOf(profile));
  const [tried, setTried] = useState(false);
  const ids = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      setDraft(draftOf(profile));
      setTried(false);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, profile]);
  const edited = profileOf(draft);
  return (
    <dialog ref={dialog} className="rmp-dialog" aria-labelledby={`${ids}-title`} onClose={onClose}>
      <form
        method="dialog"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (edited === null) return setTried(true);
          onSave(edited);
          onClose();
        }}
      >
        <h2 id={`${ids}-title`} className="text-base font-semibold">
          Edit profile
        </h2>
        <ProfileFields value={draft} onChange={setDraft} nameError={tried && edited === null ? NAME_MISSING : null} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="default">
            Save
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** The description as text under the title: no box, it grows with what is typed. */
export function BareTextarea({ value, onChange, onBlur, className }: { value: string; onChange(next: string): void; onBlur?: () => void; className: string }) {
  const text = "col-start-1 row-start-1 text-base leading-6 whitespace-pre-wrap [overflow-wrap:anywhere] sm:text-sm sm:leading-5";
  return (
    <div className="grid min-w-0">
      <textarea
        aria-label="Description"
        placeholder="Add a description"
        maxLength={DESCRIPTION_MAX}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={`${text} rmp-bare resize-none overflow-hidden rounded-sm focus-visible:ring-1 focus-visible:ring-ring ${className}`}
      />
      <span aria-hidden className={`${text} invisible`}>{`${value} `}</span>
    </div>
  );
}

