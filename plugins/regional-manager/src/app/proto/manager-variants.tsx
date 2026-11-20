// PROTOTYPE (i7), throwaway: three directions for the page of a manager with no thread yet.
//   Board  – the board page's header (All, Edit), its identity, then the composer: the same page
//            before and after the manager starts. Edit opens in place, with Save and Cancel.
//   Center – bb's own new-thread page, made this manager's: its avatar and name centred over the
//            composer. Edit is a pencil by the name that opens a dialog.
//   Thread – the thread it will become: the profile heads an empty timeline, the composer sits at
//            the foot where the thread's will. The name and description are the fields: no Edit.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useId, useState } from "react";
import { NAME_MAX, type Profile } from "../../model/profile.ts";
import { draftOf, NAME_MISSING, profileOf, type ProfileDraft } from "../profile/profile-draft.ts";
import { ProfileFields } from "../profile/profile-fields.tsx";
import { Button } from "../ui/button.tsx";
import { AvatarIcon, BackToAll, BareTextarea, EditDialog, GoalComposer, IconGrid, NotStartedGlyph, PageShell, SentNotice } from "./parts.tsx";

type ManagerProps = { id: string; profile: Profile; onProfile(next: Profile): void; onBack(): void };

export const MANAGER_VARIANTS = [
  { name: "Board", render: (props: ManagerProps) => <BoardLike {...props} /> },
  { name: "Center", render: (props: ManagerProps) => <Centered {...props} /> },
  { name: "Thread", render: (props: ManagerProps) => <ThreadLike {...props} /> },
] as const;

function Goal({ id, name }: { id: string; name: string }) {
  const [sent, setSent] = useState(false);
  return sent ? <SentNotice name={name} onReset={() => setSent(false)} /> : <GoalComposer name={name} draftKey={id} onSent={() => setSent(true)} />;
}

// ------------------------------------------------------------------ Board

function BoardLike({ id, profile, onProfile, onBack }: ManagerProps) {
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  return (
    <PageShell>
      <header className="flex flex-col gap-3">
        <div className="flex w-full items-center justify-between gap-2">
          <BackToAll onBack={onBack} />
          {draft === null && (
            <Button variant="ghost" size="sm" onClick={() => setDraft(draftOf(profile))}>
              <Icon name="Edit" aria-hidden />
              Edit
            </Button>
          )}
        </div>
        {draft === null ? (
          <div className="flex items-start gap-3 px-3">
            <AvatarIcon avatar={profile.avatar} size="lg" />
            <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
              <h1 className="text-base font-medium text-pretty [overflow-wrap:anywhere]">{profile.name}</h1>
              {profile.description !== null && <p className="text-sm whitespace-pre-wrap text-pretty text-muted-foreground [overflow-wrap:anywhere]">{profile.description}</p>}
            </div>
          </div>
        ) : (
          <InlineEditor draft={draft} onChange={setDraft} onSave={(next) => (onProfile(next), setDraft(null))} onCancel={() => setDraft(null)} />
        )}
      </header>
      <Goal id={id} name={profile.name} />
    </PageShell>
  );
}

/** The board's own editor (profile-editor.tsx), on a mock: the fields, Save and Cancel. */
function InlineEditor({ draft, onChange, onSave, onCancel }: { draft: ProfileDraft; onChange(next: ProfileDraft): void; onSave(next: Profile): void; onCancel(): void }) {
  const [tried, setTried] = useState(false);
  const edited = profileOf(draft);
  return (
    <form
      aria-label="Edit profile"
      className="flex flex-col gap-3 px-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (edited === null) return setTried(true);
        onSave(edited);
      }}
    >
      <ProfileFields value={draft} onChange={onChange} nameError={tried && edited === null ? NAME_MISSING : null} />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="default" size="sm">
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ Center

function Centered({ id, profile, onProfile, onBack }: ManagerProps) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <div className="absolute top-6 left-4 sm:left-6">
        <BackToAll onBack={onBack} />
      </div>
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-6 px-4 pt-20 pb-24 sm:px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <AvatarIcon avatar={profile.avatar} size="xl" />
          <div className="flex max-w-full items-center gap-1">
            <h1 className="min-w-0 text-2xl leading-8 font-semibold text-balance [overflow-wrap:anywhere]">{profile.name}</h1>
            <button
              type="button"
              aria-label="Edit profile"
              title="Edit profile"
              onClick={() => setEditing(true)}
              className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 before:absolute before:-inset-1.5 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_[data-icon-root]]:size-4"
            >
              <Icon name="Edit" aria-hidden />
            </button>
          </div>
          {profile.description !== null && <p className="max-w-[60ch] text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">{profile.description}</p>}
        </div>
        <Goal id={id} name={profile.name} />
      </div>
      <EditDialog open={editing} profile={profile} onSave={onProfile} onClose={() => setEditing(false)} />
    </div>
  );
}

// ------------------------------------------------------------------ Thread

function ThreadLike({ id, profile, onProfile, onBack }: ManagerProps) {
  const ids = useId();
  const [picking, setPicking] = useState(false);
  // The fields hold what is typed; a blur saves it when it is a profile (a blank name goes back).
  const [draft, setDraft] = useState<ProfileDraft>(draftOf(profile));
  const save = () => {
    const next = profileOf(draft);
    if (next === null) setDraft(draftOf(profile));
    else onProfile(next);
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
          <div>
            <BackToAll onBack={onBack} />
          </div>
          <div className="flex items-start gap-3 px-3">
            <button
              type="button"
              aria-label="Icon"
              aria-expanded={picking}
              aria-controls={`${ids}-icons`}
              onClick={() => setPicking(!picking)}
              className="cursor-pointer rounded-lg transition-transform duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.96]"
            >
              <AvatarIcon avatar={draft.avatar} size="lg" />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
              <input
                aria-label="Name"
                autoComplete="off"
                maxLength={NAME_MAX}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                onBlur={save}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                className="rmp-bare rounded-sm text-base leading-6 font-medium focus-visible:ring-1 focus-visible:ring-ring"
              />
              <BareTextarea value={draft.description} onChange={(description) => setDraft({ ...draft, description })} onBlur={save} className="text-muted-foreground" />
            </div>
          </div>
          {picking && (
            <div id={`${ids}-icons`} className="px-3">
              <IconGrid
                value={draft.avatar}
                onChange={(avatar) => {
                  const next = { ...draft, avatar };
                  setDraft(next);
                  const saved = profileOf(next);
                  if (saved !== null) onProfile(saved);
                }}
              />
            </div>
          )}
          <div className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
            <NotStartedGlyph />
            <span>Not started. Its first message is its goal.</span>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-20 sm:px-6">
        <Goal id={id} name={draft.name.trim() === "" ? profile.name : draft.name} />
      </div>
    </div>
  );
}
