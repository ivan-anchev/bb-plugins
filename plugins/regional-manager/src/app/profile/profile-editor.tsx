import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { draftOf, NAME_MISSING, profileOf, type ProfileDraft } from "./profile-draft.ts";
import { ProfileFields } from "./profile-fields.tsx";

type ProfileEditorProps = {
  coordinatorId: CoordinatorId;
  /** The profile as saved, which Esc goes back to while nothing was changed. */
  profile: Profile;
  /** The fields as the user left them; the browser keeps them, so an edit outlives bb redrawing the panel. */
  draft: ProfileDraft;
  onChange(next: ProfileDraft): void;
  onClose(): void;
  /** Takes the focus of what opened the editor, as the name field mounts. */
  takeFocus(name: HTMLElement | null): void;
  /** What sits at the end of the form's actions, after Save and Cancel, such as a regional manager's Delete. */
  trailing?: ReactNode;
};

export function ProfileEditor({ coordinatorId, profile, draft, onChange, onClose, takeFocus, trailing }: ProfileEditorProps) {
  const [tried, setTried] = useState(false);
  const name = useRef<HTMLInputElement | null>(null);
  const nameRef = useCallback(
    (input: HTMLInputElement | null) => {
      name.current = input;
      takeFocus(input);
    },
    [takeFocus],
  );
  const save = experimental_useRpcMutation({ contract, method: "setProfile" });
  const edited = profileOf(draft);
  useHoldEscape(true);

  function submit() {
    if (save.isPending) return;
    if (edited === null) {
      setTried(true);
      name.current?.focus();
      return;
    }
    save.mutate({ coordinatorId, profile: edited }).then(
      () => {
        if (name.current !== null) onClose();
      },
      () => {},
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && JSON.stringify(draft) === JSON.stringify(draftOf(profile))) onClose();
  }

  return (
    <form
      aria-label="Edit profile"
      className="flex flex-col gap-3"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <ProfileFields value={draft} onChange={onChange} nameError={tried && edited === null ? NAME_MISSING : null} nameRef={nameRef} />
      {save.error !== null && (
        <p role="alert" className="text-sm text-destructive-text">
          Could not save it: {save.error.message}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="default" size="sm" aria-disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {trailing !== undefined && <span className="ml-auto">{trailing}</span>}
      </div>
    </form>
  );
}
