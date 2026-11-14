// Registration only: the notes icon, the Spotlight and the three ways into it, and the homepage card.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { NotesCard } from "./src/app/home/notes-card.tsx";
import { captureFrom } from "./src/app/spotlight/capture.ts";
import { Spotlight } from "./src/app/spotlight/spotlight.tsx";
import { spotlight } from "./src/app/spotlight/spotlight-store.ts";
import { NOTE_ICON, NoteIcon } from "./src/app/ui/note-icon.tsx";
import "./src/app/home/notes-card.css";
import "./src/app/spotlight/spotlight.css";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: NOTE_ICON, component: NoteIcon });

  // The one owner of the modal: mounted once per window, opened through `spotlight` from anywhere.
  app.slots.experimental_appOverlay({ id: "spotlight", component: Spotlight });

  // The selection menu on assistant replies, and the action bar under every message.
  app.slots.messageAction({ id: "add-to-notes", title: "Add to notes", icon: NOTE_ICON, run: (context) => spotlight.compose(captureFrom(context)) });

  const newNote = () => spotlight.compose(null);
  // why ⇧⌘J: bb desktop binds ⇧⌘N to New window, and a plugin default that collides stays unbound.
  app.commands.register({ id: "new-note", title: "New note", defaultShortcut: { key: "j", mod: true, shift: true }, run: newNote });
  app.experimental_sidebarFooter.register({ kind: "action", id: "notes", label: "New note", icon: NOTE_ICON, onActivate: newNote });

  // why: bb draws this title as an <h2> above the section; notes-card.css hides it, the card has its own.
  app.slots.homepageSection({ id: "notes", title: "Notes", component: NotesCard });
});
