// The Spotlight's compose mode: the quoted passage (if any), a textarea where @ links a thread,
// images and videos attached with 📎, a paste or a drop, ⌘↵ to save. Look and keys from
// prototypes/notes-capture.html, variant Spotlight.
import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { Close, Content, Title } from "@radix-ui/react-dialog";
import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject, type SyntheticEvent } from "react";
import { toast } from "sonner"; // runtime-shimmed to bb's own toast
import { notesContract, type NoteBody, type Quote } from "../../../contract.ts";
import { NOTE_ICON } from "../../ui/note-icon.tsx";
import { PORTAL_SCOPE } from "../../ui/portal-scope.ts";
import { useReturnFocus } from "../../ui/return-focus.ts";
import { QuoteBlock } from "../quote-block.tsx";
import { AttachButton } from "./attach-button.tsx";
import { useDraftFiles, type DraftFiles } from "./draft-files.ts";
import { LinkChips } from "./link-chips.tsx";
import { activeQuery, insertAtSign, insertToken, linkedThreads, removeToken, toNoteBody, type Draft, type PickedThread } from "./mention-text.ts";
import { ThreadPicker, useThreadMatches } from "./thread-picker.tsx";
import { Thumbs } from "./thumbs.tsx";

export function ComposeForm({ quote, onSaved }: { quote: Quote | null; onSaved(): void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const draft = useDraft(field);
  const [picked, setPicked] = useState<PickedThread[]>([]);
  const picker = useThreadMatches(activeQuery(draft.value, picked));
  const files = useDraftFiles();
  const save = useSave(quote, toNoteBody(draft.value.text, picked), files, onSaved);
  const returnFocus = useReturnFocus();

  const pick = (thread: PickedThread) => {
    draft.edit(insertToken(draft.value, picked, thread));
    setPicked((all) => [...all, thread]);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // why: Enter that confirms an IME composition is neither a pick nor a save.
    if (event.nativeEvent.isComposing) return;
    if (picker.onKeyDown(event, pick)) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save.run();
    }
  };

  return (
    <Content
      {...PORTAL_SCOPE}
      className="nt-spot"
      data-dropping={files.dragging || undefined}
      aria-describedby={undefined}
      onCloseAutoFocus={returnFocus}
      // why the whole dialog: a file dropped or pasted anywhere on the Spotlight is attached.
      onPaste={files.onPaste}
      onDragOver={files.onDragOver}
      onDragLeave={files.onDragLeave}
      onDrop={files.onDrop}
      // why: Esc closes the @ picker first, and the Spotlight only when no picker is open.
      onEscapeKeyDown={(event) => {
        if (!picker.isOpen) return;
        event.preventDefault();
        picker.dismiss();
      }}
    >
      <Title className="nt-spot-title">
        <Icon name={NOTE_ICON} className="nt-spot-icon" aria-hidden />
        {quote === null ? "New note" : "Save selection to notes"}
        <kbd className="nt-kbd nt-end">esc</kbd>
      </Title>
      {quote !== null && <QuoteBlock quote={quote} />}
      <div className="nt-field">
        <textarea
          ref={field}
          className="nt-spot-text"
          autoFocus
          rows={3}
          aria-label="Note"
          placeholder={quote === null ? "Write a note… type @ to link a thread" : "Why does this matter? Type @ to link a thread"}
          value={draft.value.text}
          onChange={draft.onChange}
          onSelect={draft.onSelect}
          onKeyDown={onKeyDown}
          {...picker.fieldProps}
        />
        {picker.isOpen && <ThreadPicker picker={picker} onPick={pick} />}
      </div>
      <LinkChips threads={linkedThreads(draft.value.text, picked)} onUnlink={(thread) => draft.edit(removeToken(draft.value, picked, thread))} />
      <Thumbs
        items={files.items}
        onRemove={(item) => {
          files.remove(item);
          // why: the × leaves the page with its thumb, and focus must not fall to the page body.
          field.current!.focus();
        }}
      />
      {files.refused !== null && (
        <p className="nt-spot-refused" role="status">
          {files.refused}
        </p>
      )}
      {save.error !== null && (
        <p className="nt-spot-error" role="alert">
          Couldn’t save: {save.error}
        </p>
      )}
      <div className="nt-spot-foot">
        <AttachButton onFiles={files.add} />
        <button type="button" className="nt-icon-button" aria-label="Link a thread" onClick={() => draft.edit(insertAtSign(draft.value))}>
          @
        </button>
        <span className="nt-spot-hint nt-end">
          <kbd className="nt-kbd">⌘↵</kbd> to save
        </span>
        <Close asChild>
          <button type="button" className="nt-button">
            Cancel
          </button>
        </Close>
        <button type="button" className="nt-button" data-primary="" disabled={!save.canSave} onClick={save.run}>
          {save.saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </Content>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * The textarea's text and caret. Typing and moving the caret update them; `edit` (a pick, a chip's
 * ×, the @ button) writes both, then puts focus and the caret back in the field once the new text is
 * drawn.
 */
function useDraft(field: RefObject<HTMLTextAreaElement | null>) {
  const [value, setValue] = useState<Draft>({ text: "", caret: 0 });
  const placeCaret = useRef(false);
  // why a layout effect: React draws a new value with the caret at the end, and the plugin runtime
  // shares react but not react-dom, so flushSync can't place it in the handler.
  useLayoutEffect(() => {
    if (!placeCaret.current) return;
    placeCaret.current = false;
    const textarea = field.current!;
    textarea.focus();
    textarea.setSelectionRange(value.caret, value.caret);
  }, [field, value]);
  return {
    value,
    edit(next: Draft) {
      placeCaret.current = true;
      setValue(next);
    },
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setValue({ text: event.target.value, caret: event.target.selectionStart }),
    onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const caret = event.currentTarget.selectionStart;
      setValue((current) => (current.caret === caret ? current : { ...current, caret }));
    },
  };
}

/**
 * Saving reads the files, then sends the note once; success closes and toasts, a failure keeps the
 * draft and says why. A quote or a file is a note on its own, so with one the text may stay empty.
 */
function useSave(quote: Quote | null, body: NoteBody, files: DraftFiles, onSaved: () => void) {
  const create = experimental_useRpcMutation({ contract: notesContract, method: "createNote" });
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const saving = reading || create.isPending;
  const canSave = (quote !== null || body.text !== "" || files.items.length > 0) && !saving;
  const run = () => {
    if (!canSave) return;
    setReading(true);
    setReadError(null);
    files.encode().then(
      (encoded) => {
        setReading(false);
        create.mutate({ quote, body, files: encoded }).then(
          () => {
            onSaved();
            toast.success("Saved to notes");
          },
          // why swallowed: the hook keeps the failure in `create.error`, which the form shows.
          () => undefined,
        );
      },
      (error: unknown) => {
        setReading(false);
        setReadError(error instanceof Error ? error.message : String(error));
      },
    );
  };
  return { canSave, saving, error: readError ?? create.error?.message ?? null, run };
}
