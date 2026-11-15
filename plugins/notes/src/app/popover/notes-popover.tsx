// experimental_appOverlay: the Notes popover. It floats beside the sidebar, its bottom level with the
// footer's Notes button, on any bb screen: the shared panel with the composer at the bottom. bb's host
// shims Radix, so this popover shares bb's dismiss and focus layers. Esc closes the @ picker, then
// clears picks, then closes; a click outside closes; focus goes back where it came from.
import { Anchor, Content, Portal, Root } from "@radix-ui/react-popover";
import { useEffect, useRef, useState, type RefObject } from "react";
import { NoteForm, type NoteFormHandle } from "../compose/note-form.tsx";
import { NotesPanel } from "../panel/notes-panel.tsx";
import { usePicks } from "../panel/use-picks.ts";
import { PORTAL_SCOPE } from "../ui/portal-scope.ts";
import { isNewNoteShortcut } from "../ui/shortcut.ts";
import { useNotes } from "../use-notes.ts";
import { anchorRect, footerButton, GAP, isFooterItem } from "./footer-anchor.ts";
import { notesPopover, usePopoverState, type PopoverState } from "./popover-store.ts";

type OpenState = Extract<PopoverState, { open: true }>;

const ANCHOR = { current: { getBoundingClientRect: anchorRect } };

export function NotesPopover() {
  const state = usePopoverState();
  // The last opening stays drawn while the popover animates out.
  const [shown, setShown] = useState<OpenState | null>(null);
  if (state.open && state !== shown) setShown(state);
  return (
    <Root open={state.open} onOpenChange={(open) => !open && notesPopover.close()}>
      <Anchor virtualRef={ANCHOR} />
      {/* why keyed by opening: each opening starts with a fresh draft and no picks. */}
      {shown !== null && <Opening key={shown.opening} state={shown} />}
    </Root>
  );
}

// ------------------------------------------------------------------ layer 2

function Opening({ state }: { state: OpenState }) {
  // why read while rendering: this renders as the popover opens, before it takes focus.
  const [opener] = useState(() => document.activeElement);
  const content = useRef<HTMLDivElement>(null);
  const form = useRef<NoteFormHandle>(null);
  const notes = useNotes();
  const picks = usePicks(notes.data ?? []);
  /** Closed by a click outside or by a start: focus stays where that put it. */
  const quiet = useRef(false);

  const closeQuietly = () => {
    quiet.current = true;
    notesPopover.close();
  };

  return (
    <Portal>
      <Content
        {...PORTAL_SCOPE}
        ref={content}
        className="nt-popover"
        aria-label="Notes"
        side="right"
        align="end"
        sideOffset={GAP}
        // why no bottom padding: bb's footer button sits 7px off the window's bottom, and the popover
        // lines up with it.
        collisionPadding={{ top: GAP }}
        // why: FocusOnRequest places focus, on the form or on the popover itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!quiet.current) returnFocus(state, opener);
        }}
        onEscapeKeyDown={(event) => {
          if (form.current!.dismissPicker()) event.preventDefault();
          else if (picks.ids.length > 0) {
            event.preventDefault();
            picks.clear();
          }
        }}
        // why here: bb runs no plugin command while focus is in the popover, so its shortcut closes it.
        onKeyDown={(event) => {
          if (!isNewNoteShortcut(event)) return;
          event.preventDefault();
          notesPopover.close();
        }}
        // why: New thread from another screen goes to New thread first, whose composer takes focus;
        // the popover stays until the draft holds the notes (use-start-thread.ts).
        onFocusOutside={(event) => {
          if (picks.held) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          // why: the footer button's own click toggles the popover, and must not reopen it.
          if (isFooterItem(event.target)) event.preventDefault();
          else quiet.current = true;
        }}
      >
        <FocusOnRequest state={state} content={content} form={form} />
        <NotesPanel
          notes={notes}
          picks={picks}
          form={<NoteForm ref={form} capture={state.quote} />}
          onClose={notesPopover.close}
          onStarted={closeQuietly}
          isCurrent={() => notesPopover.isShowing(state.opening)}
        />
      </Content>
    </Portal>
  );
}

type FocusOnRequestProps = { state: OpenState; content: RefObject<HTMLDivElement | null>; form: RefObject<NoteFormHandle | null> };

/**
 * Moves focus on every request: to the composer's field or to the popover itself. The first request
 * is the opening's. why a component inside the popover:
 * its effect runs once the popover's portaled content exists.
 */
function FocusOnRequest({ state: { focus, focusRequest }, content, form }: FocusOnRequestProps) {
  useEffect(() => {
    if (focus === "form") form.current!.focus();
    else content.current!.focus();
  }, [focus, focusRequest, content, form]);
  return null;
}

/** Back to the footer button when it opened the popover, else to whatever had focus then. */
function returnFocus(state: OpenState, opener: Element | null): void {
  const target = state.openedBy === "button" ? footerButton() : opener;
  if (target instanceof HTMLElement && target.isConnected) target.focus();
}
