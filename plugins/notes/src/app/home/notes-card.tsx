import { NotesPanel } from "../panel/notes-panel.tsx";
import { usePicks } from "../panel/use-picks.ts";
import { notesPopover } from "../popover/popover-store.ts";
import { useHoldEscape } from "../ui/use-hold-escape.ts";
import { useNotes } from "../use-notes.ts";

export function NotesCard() {
  const notes = useNotes();
  const picks = usePicks(notes.data ?? []);
  useHoldEscape(picks.ids.length > 0, picks.clear);
  return (
    <div className="nt-card">
      <NotesPanel notes={notes} picks={picks} onNewNote={notesPopover.write} />
    </div>
  );
}
