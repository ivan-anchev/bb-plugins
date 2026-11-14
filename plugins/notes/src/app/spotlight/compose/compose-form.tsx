// The Spotlight's compose mode: a textarea, ⌘↵ to save. Look and keys from
// prototypes/notes-capture.html, variant Spotlight.
import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { Close, Content, Title } from "@radix-ui/react-dialog";
import { useState, type KeyboardEvent } from "react";
import { toast } from "sonner"; // runtime-shimmed to bb's own toast
import { notesContract } from "../../../contract.ts";
import { NOTE_ICON } from "../../ui/note-icon.tsx";
import { PORTAL_SCOPE } from "../../ui/portal-scope.ts";
import { useReturnFocus } from "../../ui/return-focus.ts";

export function ComposeForm({ onSaved }: { onSaved(): void }) {
  const [text, setText] = useState("");
  const save = useSave(text, onSaved);
  const returnFocus = useReturnFocus();

  const onKeyDown = (event: KeyboardEvent) => {
    // why: Enter that confirms an IME composition is not a save.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save.run();
    }
  };

  return (
    <Content {...PORTAL_SCOPE} className="nt-spot" aria-describedby={undefined} onCloseAutoFocus={returnFocus}>
      <Title className="nt-spot-title">
        <Icon name={NOTE_ICON} className="nt-spot-icon" aria-hidden />
        New note
        <kbd className="nt-kbd nt-end">esc</kbd>
      </Title>
      <textarea
        className="nt-spot-text"
        autoFocus
        rows={3}
        aria-label="Note"
        placeholder="Write a note…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {save.error !== null && (
        <p className="nt-spot-error" role="alert">
          Couldn’t save: {save.error}
        </p>
      )}
      <div className="nt-spot-foot">
        <span className="nt-spot-hint nt-end">
          <kbd className="nt-kbd">⌘↵</kbd> to save
        </span>
        <Close asChild>
          <button type="button" className="nt-button">
            Cancel
          </button>
        </Close>
        <button type="button" className="nt-button" data-primary="" disabled={!save.canSave} onClick={save.run}>
          Save note
        </button>
      </div>
    </Content>
  );
}

// ------------------------------------------------------------------ layer 2

/** Saving sends the note once; success closes and toasts, a failure keeps the draft and says why. */
function useSave(text: string, onSaved: () => void) {
  const create = experimental_useRpcMutation({ contract: notesContract, method: "createNote" });
  const body = text.trim();
  const canSave = body !== "" && !create.isPending;
  const run = () => {
    if (!canSave) return;
    create.mutate({ quote: null, body: { text: body, mentions: [] } }).then(
      () => {
        onSaved();
        toast.success("Saved to notes");
      },
      // why swallowed: the hook keeps the failure in `create.error`, which the form shows.
      () => undefined,
    );
  };
  return { canSave, error: create.error?.message ?? null, run };
}
