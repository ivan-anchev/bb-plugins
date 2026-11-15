// The popover's composer, pinned under the list and always open: the quoted passage, if any, thumbs
// of what is attached, a textarea where @ links a thread, and a bar of 📎, @, link chips and a round
// send (⌘↵). It grows upward, and the @ picker opens above it. Look from prototypes/notes-input.html,
// Composer.
import { experimental_Icon as Icon, experimental_useRpcMutation, experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { notesContract, type NoteBody, type Quote } from "../../contract.ts";
import { notesPopover, type Capture } from "../popover/popover-store.ts";
import { QuoteBlock } from "../quote-block.tsx";
import { AttachButton } from "./attach-button.tsx";
import { useDraftFiles, type DraftFiles } from "./draft-files.ts";
import { LinkChips } from "./link-chips.tsx";
import { activeQuery, insertAtSign, insertToken, linkedThreads, removeToken, toNoteBody, type Draft, type PickedThread } from "./mention-text.ts";
import { ThreadPicker, useThreadMatches } from "./thread-picker.tsx";
import { Thumbs } from "./thumbs.tsx";

/** What the popover asks of its form: focus for ⇧⌘J and the openers, and Esc for the @ picker first. */
export type NoteFormHandle = {
  focus(): void;
  /** Closes the @ picker; false when it was not open, so Esc goes on to the popover. */
  dismissPicker(): boolean;
};

export function NoteForm({ capture, ref }: { capture: Capture | null; ref: Ref<NoteFormHandle> }) {
  // why a key: each save starts the next note from a fresh draft, its files freed, its field focused.
  const [saved, setSaved] = useState(0);
  return (
    <NoteDraft
      key={saved}
      ref={ref}
      capture={capture}
      focusOnMount={saved > 0}
      onSaved={() => {
        if (capture !== null) notesPopover.clearQuote(capture);
        setSaved((count) => count + 1);
      }}
    />
  );
}

// ------------------------------------------------------------------ layer 2

type NoteDraftProps = {
  capture: Capture | null;
  focusOnMount: boolean;
  onSaved(): void;
  ref: Ref<NoteFormHandle>;
};

function NoteDraft({ capture, focusOnMount, onSaved, ref }: NoteDraftProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const quote = useQuote(capture);
  const draft = useDraft(field);
  const [picked, setPicked] = useState<PickedThread[]>([]);
  const picker = useThreadMatches(activeQuery(draft.value, picked));
  const files = useDraftFiles();
  const save = useSave(quote, toNoteBody(draft.value.text, picked), files, onSaved);

  useImperativeHandle(ref, () => ({
    focus: () => field.current!.focus(),
    dismissPicker() {
      if (!picker.isOpen) return false;
      picker.dismiss();
      return true;
    },
  }));

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
    <div
      className="nt-form"
      data-dropping={files.dragging || undefined}
      // why the whole form: a file dropped anywhere on it is attached.
      onDragOver={files.onDragOver}
      onDragLeave={files.onDragLeave}
      onDrop={files.onDrop}
    >
      {picker.isOpen && <ThreadPicker picker={picker} onPick={pick} />}
      <div className="nt-form-box">
        {quote !== null && <QuoteBlock quote={quote} />}
        <Thumbs
          items={files.items}
          onRemove={(item) => {
            files.remove(item);
            // why: the × leaves the page with its thumb, and focus must not fall to the page body.
            field.current!.focus();
          }}
        />
        <textarea
          ref={field}
          className="nt-form-text"
          rows={1}
          autoFocus={focusOnMount}
          aria-label="New note"
          placeholder={quote === null ? "Write a note…" : "Why does this matter?"}
          value={draft.value.text}
          onChange={draft.onChange}
          onSelect={draft.onSelect}
          onKeyDown={onKeyDown}
          onPaste={files.onPaste}
          {...picker.fieldProps}
        />
        <div className="nt-form-bar">
          <AttachButton onFiles={files.add} />
          <button type="button" className="nt-icon-button" aria-label="Link a thread" onClick={() => draft.edit(insertAtSign(draft.value))}>
            @
          </button>
          <LinkChips threads={linkedThreads(draft.value.text, picked)} onUnlink={(thread) => draft.edit(removeToken(draft.value, picked, thread))} />
          <button type="button" className="nt-send" aria-label="Save note (⌘↵)" aria-busy={save.saving} disabled={!save.canSave} onClick={save.run}>
            <Icon name="ArrowUp" aria-hidden />
          </button>
        </div>
      </div>
      {files.refused !== null && (
        <p className="nt-caption" role="status">
          {files.refused}
        </p>
      )}
      {save.error !== null && (
        <p className="nt-caption nt-error" role="alert">
          Couldn’t save: {save.error}
        </p>
      )}
    </div>
  );
}

/** The capture with its thread's title; until the sidebar's threads have loaded, the thread's id. */
function useQuote(capture: Capture | null): Quote | null {
  const { threads } = experimental_useSidebarThreads();
  if (capture === null) return null;
  const thread = threads.find((candidate) => candidate.id === capture.threadId);
  return { ...capture, threadTitle: thread?.displayTitle ?? capture.threadId };
}

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
 * Saving reads the files, then sends the note once; success starts the next note, a failure keeps
 * the draft and says why. A quote or a file is a note on its own, so with one the text may stay empty.
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
          onSaved,
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
