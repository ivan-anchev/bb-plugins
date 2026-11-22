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
  const [shown, setShown] = useState<OpenState | null>(null);
  if (state.open && state !== shown) setShown(state);
  return (
    <Root open={state.open} onOpenChange={(open) => !open && notesPopover.close()}>
      <Anchor virtualRef={ANCHOR} />
      {shown !== null && <Opening key={shown.opening} state={shown} />}
    </Root>
  );
}

function Opening({ state }: { state: OpenState }) {
  const [opener] = useState(() => document.activeElement);
  const content = useRef<HTMLDivElement>(null);
  const form = useRef<NoteFormHandle>(null);
  const notes = useNotes();
  const picks = usePicks(notes.data ?? []);
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
        collisionPadding={{ top: GAP }}
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
        onKeyDown={(event) => {
          if (!isNewNoteShortcut(event)) return;
          event.preventDefault();
          notesPopover.close();
        }}
        onFocusOutside={(event) => {
          if (picks.held) event.preventDefault();
        }}
        onInteractOutside={(event) => {
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

function FocusOnRequest({ state: { focus, focusRequest }, content, form }: FocusOnRequestProps) {
  useEffect(() => {
    if (focus === "form") form.current!.focus();
    else content.current!.focus();
  }, [focus, focusRequest, content, form]);
  return null;
}

function returnFocus(state: OpenState, opener: Element | null): void {
  const target = state.openedBy === "button" ? footerButton() : opener;
  if (target instanceof HTMLElement && target.isConnected) target.focus();
}
