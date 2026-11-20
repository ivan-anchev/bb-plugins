// PROTOTYPE (i7), throwaway: four directions for i6's New page, which only names a manager.
//   Form    – today's fields, trimmed to the profile: the baseline.
//   Title   – the page is the manager's page before it exists: a bare title, its icon above it.
//   Preview – labelled fields, and the row it will be in the list, drawn live.
//   Dialog  – no page: New opens a dialog over the list.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DESCRIPTION_MAX, NAME_MAX, type Profile } from "../../model/profile.ts";
import { EMPTY_DRAFT, NAME_MISSING, profileOf, type ProfileDraft } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { Button } from "../ui/button.tsx";
import { GrowingTextarea } from "../ui/growing-textarea.tsx";
import { AvatarIcon, BackToAll, BareTextarea, IconGrid, NotStartedGlyph, PageShell } from "./parts.tsx";
import { MarkedList } from "./row-variants.tsx";

type NewProps = { onBack(): void; onCreated(profile: Profile): void };

export const NEW_VARIANTS = [
  { name: "Form", render: (props: NewProps) => <FormNew {...props} /> },
  { name: "Title", render: (props: NewProps) => <TitleNew {...props} /> },
  { name: "Preview", render: (props: NewProps) => <PreviewNew {...props} /> },
  { name: "Dialog", render: (props: NewProps) => <DialogNew {...props} /> },
] as const;

/** The draft every variant edits, and Create: a missing name says so in its field and takes focus. */
function useNewDraft(onCreated: (profile: Profile) => void) {
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const profile = profileOf(draft);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (profile === null) {
      setTried(true);
      nameRef.current?.focus();
      return;
    }
    onCreated(profile);
  };
  return { draft, setDraft, nameRef, submit, nameError: tried && profile === null ? NAME_MISSING : null };
}

function Heading({ children }: { children: ReactNode }) {
  return <h1 className="px-3 text-base font-medium">{children}</h1>;
}

// ------------------------------------------------------------------ Form

function FormNew({ onBack, onCreated }: NewProps) {
  const form = useNewDraft(onCreated);
  return (
    <PageShell>
      <div className="flex flex-col items-start gap-3">
        <BackToAll onBack={onBack} />
        <Heading>New regional manager</Heading>
      </div>
      <form onSubmit={form.submit} className="flex flex-col gap-5 px-3">
        <ProfileFields value={form.draft} onChange={form.setDraft} nameError={form.nameError} nameRef={form.nameRef} />
        <div>
          <Button type="submit" variant="default">
            Create
          </Button>
        </div>
      </form>
    </PageShell>
  );
}

// ------------------------------------------------------------------ Title

function TitleNew({ onBack, onCreated }: NewProps) {
  const form = useNewDraft(onCreated);
  const [picking, setPicking] = useState(false);
  const ids = useId();
  return (
    <PageShell>
      <div className="flex flex-col items-start">
        <BackToAll onBack={onBack} />
      </div>
      <form onSubmit={form.submit} className="flex flex-col gap-4 px-3">
        <div className="flex flex-col items-start gap-3">
          <button
            type="button"
            aria-expanded={picking}
            aria-controls={`${ids}-icons`}
            aria-label="Icon"
            onClick={() => setPicking(!picking)}
            className="cursor-pointer rounded-xl transition-transform duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.96]"
          >
            <AvatarIcon avatar={form.draft.avatar} size="xl" />
          </button>
          {picking && (
            <div id={`${ids}-icons`}>
              <IconGrid
                value={form.draft.avatar}
                onChange={(avatar) => {
                  form.setDraft({ ...form.draft, avatar });
                }}
              />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={form.nameRef}
            aria-label="Name"
            placeholder="Name"
            autoComplete="off"
            maxLength={NAME_MAX}
            value={form.draft.name}
            onChange={(event) => form.setDraft({ ...form.draft, name: event.target.value })}
            aria-invalid={form.nameError !== null}
            aria-describedby={form.nameError === null ? undefined : `${ids}-error`}
            className="rmp-bare text-2xl leading-8 font-semibold text-foreground"
          />
          {form.nameError !== null && (
            <p id={`${ids}-error`} role="alert" className="text-xs text-destructive-text">
              {form.nameError}
            </p>
          )}
          <BareTextarea value={form.draft.description} onChange={(description) => form.setDraft({ ...form.draft, description })} className="text-muted-foreground" />
        </div>
        <div className="pt-2">
          <Button type="submit" variant="default">
            Create
          </Button>
        </div>
      </form>
    </PageShell>
  );
}

// ------------------------------------------------------------------ Preview

function PreviewNew({ onBack, onCreated }: NewProps) {
  const form = useNewDraft(onCreated);
  const ids = useId();
  const field = "w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-base leading-6 text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive sm:text-sm sm:leading-5";
  const label = "text-xs font-medium text-muted-foreground";
  const name = form.draft.name.trim() === "" ? "Name" : form.draft.name;
  return (
    <PageShell>
      <div className="flex flex-col items-start gap-3">
        <BackToAll onBack={onBack} />
        <Heading>New regional manager</Heading>
      </div>
      <form onSubmit={form.submit} className="flex flex-col gap-5 px-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-name`} className={label}>
            Name
          </label>
          <input
            id={`${ids}-name`}
            ref={form.nameRef}
            autoComplete="off"
            maxLength={NAME_MAX}
            value={form.draft.name}
            onChange={(event) => form.setDraft({ ...form.draft, name: event.target.value })}
            aria-invalid={form.nameError !== null}
            aria-describedby={form.nameError === null ? undefined : `${ids}-error`}
            className={field}
          />
          {form.nameError !== null && (
            <p id={`${ids}-error`} role="alert" className="text-xs text-destructive-text">
              {form.nameError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-description`} className={label}>
            Description <span className="font-normal text-subtle-foreground">optional</span>
          </label>
          <GrowingTextarea id={`${ids}-description`} maxLength={DESCRIPTION_MAX} value={form.draft.description} onChange={(event) => form.setDraft({ ...form.draft, description: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={label}>Icon</span>
          <IconGrid value={form.draft.avatar} onChange={(avatar) => form.setDraft({ ...form.draft, avatar })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={label}>In the list</span>
          {/* why inert: a picture of the row it will be, not a row to open. */}
          <div inert className="rmp-list rounded-lg border border-border p-1">
            <div className="rmp-row" data-quiet={form.draft.name.trim() === "" || undefined} style={{ cursor: "default" }}>
              <span className="rmp-slot">
                <span className="rmp-mark">
                  <Icon name={form.draft.avatar.icon} />
                </span>
              </span>
              <span className="rmp-words">
                <span className="rmp-line">
                  <span className="rmp-lead">
                    <span className="rmp-title">{name}</span>
                  </span>
                  <span className="rmp-corner">
                    <NotStartedGlyph />
                  </span>
                </span>
                <span className="rmp-detail">{form.draft.description.trim() || " "}</span>
              </span>
            </div>
          </div>
        </div>
        <div>
          <Button type="submit" variant="default">
            Create
          </Button>
        </div>
      </form>
    </PageShell>
  );
}

// ------------------------------------------------------------------ Dialog

function DialogNew({ onCreated }: NewProps) {
  const [open, setOpen] = useState(true);
  const form = useNewDraft(onCreated);
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <>
      <PageShell>
        <div className="flex justify-end px-3">
          <Button variant="default" size="sm" onClick={() => setOpen(true)}>
            <Icon name="Plus" aria-hidden />
            New
          </Button>
        </div>
        <MarkedList onOpen={() => {}} />
      </PageShell>
      <dialog ref={dialog} className="rmp-dialog" aria-labelledby={`${ids}-title`} onClose={() => setOpen(false)}>
        <form onSubmit={form.submit} className="flex flex-col gap-4">
          <h2 id={`${ids}-title`} className="text-base font-semibold">
            New regional manager
          </h2>
          <ProfileFields value={form.draft} onChange={form.setDraft} nameError={form.nameError} nameRef={form.nameRef} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="default">
              Create
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
