// A regional manager's profile, edited in place on its board: its fields, with Save and Cancel.
import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useCallback, useRef, useState, type KeyboardEvent, type RefCallback } from "react";
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
  /** The fields as the user left them; the board keeps them, so an edit outlives bb redrawing the panel. */
  draft: ProfileDraft;
  onChange(next: ProfileDraft): void;
  onClose(): void;
  /** Takes the focus Edit had as the editor opened in its place. */
  takeFocus: RefCallback<HTMLElement>;
};

export function ProfileEditor({ coordinatorId, profile, draft, onChange, onClose, takeFocus }: ProfileEditorProps) {
  // Whether a save found no name: the field says so from then on, until it has one.
  const [tried, setTried] = useState(false);
  const name = useRef<HTMLInputElement | null>(null);
  const nameRef = useCallback(
    (input: HTMLInputElement | null) => {
      name.current = input;
      return takeFocus(input);
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
    // why the catch: the hook's error shows under the form, which stays open with the edit.
    save.mutate({ coordinatorId, profile: edited }).then(onClose, () => {});
  }

  // why only when nothing changed: Esc must never throw away what the user typed; Cancel does that.
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
      </div>
    </form>
  );
}
