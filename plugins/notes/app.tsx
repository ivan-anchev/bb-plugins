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

  app.slots.experimental_appOverlay({ id: "notes-popover", component: NotesPopover });
  app.slots.experimental_appOverlay({ id: "notes-in-draft", component: InDraftWatch });

  app.slots.messageAction({ id: "add-to-notes", title: "Add to notes", icon: NOTE_ICON, run: (context) => notesPopover.capture(captureFrom(context)) });

  app.commands.register({ id: "new-note", title: "New note", defaultShortcut: NEW_NOTE_SHORTCUT, run: notesPopover.write });
  app.experimental_sidebarFooter.register({ kind: "action", id: "notes", label: "Notes", icon: NOTE_ICON, onActivate: notesPopover.toggleFromButton });

  app.slots.homepageSection({ id: "notes", title: "Notes", component: NotesCard });
});
