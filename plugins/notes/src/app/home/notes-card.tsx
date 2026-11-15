// homepageSection: Notes. The shared panel in the homepage's card chrome; its height comes from its
// row (boat spend beside it), and its list scrolls. "New note" opens the popover's form.
import { NotesPanel } from "../panel/notes-panel.tsx";
import { usePicks } from "../panel/use-picks.ts";
import { notesPopover } from "../popover/popover-store.ts";
import { useHoldEscape } from "../ui/use-hold-escape.ts";
import { useNotes } from "../use-notes.ts";

export function NotesCard() {
  const notes = useNotes();
  const picks = usePicks(notes.data ?? []);
  // why: bb's own Esc leaves the page, and the picks with it. Esc clears them instead.
  useHoldEscape(picks.ids.length > 0, picks.clear);
  return (
    <div className="nt-card">
      <NotesPanel notes={notes} picks={picks} onNewNote={notesPopover.write} />
    </div>
  );
}
