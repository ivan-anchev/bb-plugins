// Registration only: the notes icon, the popover and the ways into it, the homepage card, and the
// watcher that deletes notes once they are sent.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { NotesCard } from "./src/app/home/notes-card.tsx";
import { InDraftWatch } from "./src/app/in-draft/in-draft-watch.tsx";
import { captureFrom } from "./src/app/popover/capture.ts";
import { NotesPopover } from "./src/app/popover/notes-popover.tsx";
import { notesPopover } from "./src/app/popover/popover-store.ts";
import { NOTE_ICON, NoteIcon } from "./src/app/ui/note-icon.tsx";
import { NEW_NOTE_SHORTCUT } from "./src/app/ui/shortcut.ts";
import "./src/app/panel/notes-panel.css";
import "./src/app/panel/start/start-button.css";
import "./src/app/compose/note-form.css";
import "./src/app/popover/notes-popover.css";
import "./src/app/home/notes-card.css";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: NOTE_ICON, component: NoteIcon });

  // The one owner of the popover: mounted once per window, opened through `notesPopover` from anywhere.
  app.slots.experimental_appOverlay({ id: "notes-popover", component: NotesPopover });
  // Deletes notes once the composer they were put in sends them: mounted once per window, like the popover.
  app.slots.experimental_appOverlay({ id: "notes-in-draft", component: InDraftWatch });

  // The selection menu on assistant replies, and the action bar under every message.
  app.slots.messageAction({ id: "add-to-notes", title: "Add to notes", icon: NOTE_ICON, run: (context) => notesPopover.capture(captureFrom(context)) });

  app.commands.register({ id: "new-note", title: "New note", defaultShortcut: NEW_NOTE_SHORTCUT, run: notesPopover.write });
  app.experimental_sidebarFooter.register({ kind: "action", id: "notes", label: "Notes", icon: NOTE_ICON, onActivate: notesPopover.toggleFromButton });

  // why: bb draws this title as an <h2> above the section; notes-card.css hides it, the card has its own.
  app.slots.homepageSection({ id: "notes", title: "Notes", component: NotesCard });
});
