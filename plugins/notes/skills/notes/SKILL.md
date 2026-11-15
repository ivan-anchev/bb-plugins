---
name: notes
description: Explain the Notes plugin, which saves short personal notes in bb from a Spotlight opened with ⇧⌘J, the sidebar-footer notes icon, or "Add to notes" on a chat message (a highlighted passage keeps a link to its message), links threads in a note by typing @, attaches images and videos by paste, drop or 📎, and lists notes in a Notes card on the New thread screen, where clicking one opens it read-only with Delete. Use when the user asks how to write, quote or link a note, how to read, edit or delete one, where their notes are, why ⇧⌘J does nothing, what the source chip opens, why a thread is missing from the @ picker, why a file was refused or where attached files are stored, or why the Notes card is empty or says it couldn't read notes.
---

# Notes

The Notes plugin keeps the user's own short notes. It has no CLI commands, no
agent tools and no settings; an agent cannot read or write notes.

## Writing a note

- Press ⇧⌘J (Ctrl+Shift+J off macOS) on any bb screen, or click the notes icon
  in the sidebar footer. A Spotlight box opens in the middle of the window.
- Type, then press ⌘↵ (Ctrl+Enter) or click **Save note**. The box closes and a
  "Saved to notes" toast shows. An empty box does not save.
- Esc, **Cancel** or a click outside closes the box and drops what was typed.
  Focus goes back where it was.
- If saving fails, the box stays open with the text and one line saying why.

## Saving a passage from a reply

- Highlight text in an assistant reply and choose **Add to notes** in the
  menu that appears over the selection. The Spotlight opens titled "Save
  selection to notes" with exactly the highlighted text and a source chip
  naming the thread. Typing is optional: ⌘↵ saves the quote on its own.
- **Add to notes** is also in the action bar under every message. On an
  assistant reply it quotes the whole reply, as its markdown source; on a
  user message it opens a blank note.
- The chip is bb's own thread mention for that message
  (`@thread:<id>#msg=<seq>`): clicking it opens the thread scrolled to the
  quoted message, from any screen. The Spotlight stays open over it with the
  draft; Esc closes it. Checked live on bb 0.49.
- A note keeps the thread's title as it was when saved, so it still names its
  thread after the thread is renamed, archived or deleted. If the sidebar's
  threads have not loaded yet when the Spotlight opens (or the thread is
  archived), the title is the thread's id.

## Linking threads with @

- Type `@` in the Spotlight (or click **@** in its footer) and a picker opens
  under the text: "Link a thread", with up to five of the user's active
  threads whose title contains what follows the `@` (case-insensitive).
  Archived threads are not listed.
- ↑↓ move the highlight; Enter or Tab (or a click) writes "@Title " into the
  text and adds a chip under it naming the thread. With no match the picker
  says "No thread matches …", and Enter breaks the line as usual.
- Esc closes the picker only; it stays closed until what follows the `@`
  changes. A second Esc closes the Spotlight.
- The text is what counts: a thread stays linked while its "@Title" is in the
  text. Editing or deleting that text unlinks it (its chip goes), and a chip's
  × removes every "@Title" of that thread. Typing a picked thread's "@Title"
  again by hand links it again.
- A saved note keeps each link as a range over its text. On the Notes card,
  a note without a quote shows the first thread it links on line 2; a quote's
  thread still comes first.

## Attaching images and videos

- Paste a screenshot (⌘V) into the Spotlight, drop files anywhere on it (its
  edge lights up while a file is over it), or click 📎 in its footer. Each file
  shows as a 64px thumb under the text, a video with a play badge; its ×
  removes it.
- Taken: PNG, JPEG, GIF, WebP, MP4, MOV (`video/quicktime`) and WebM, up to
  100 MB each and 20 per note. Anything else is not added and one line says
  why: "HEIC isn’t supported — convert to PNG or JPEG", "rec.mov is over
  100 MB", "A note holds 20 files at most". SVG is refused because it can run
  script.
- A note can be just its files: **Save note** is enabled with files alone, and
  reads "Saving…" while the files upload. The note is saved whole or not at
  all; if saving fails the draft keeps its files.
- On the Notes card a note with no words and no quote reads "2 screenshots"
  (images), "1 recording" (videos) or "3 attachments" (both).
- In the read-only view, images and videos sit under the note's words. A video
  plays and seeks in place; an image opens bb's lightbox, where ← → or the
  arrows step through all of the note's files, and Esc closes the lightbox
  only. HEVC videos (some iPhone recordings) may not play in bb's browser.

## The shortcut

The command is listed in Settings → Keyboard as "Plugin: notes · New note",
where it can be rebound. bb leaves a plugin's default unbound when it collides
with another binding, which is why the default is ⇧⌘J and not ⇧⌘N (bb desktop's
New window). If ⇧⌘J does nothing, check that row: another plugin may hold it.
Shortcuts do not run while a bb dialog is open, the Spotlight included.

## The Notes card

On the New thread screen, under the composer. It lists active notes newest
first, four at a time: line 1 is the note on one line (a quote saved without
words shows the quote in “ ”), line 2 the thread the quote came from, else the
first thread the note links with @ ("No thread" for a note with neither). "N more" shows the rest
and "Show fewer" folds them. A new note appears within about two seconds with
no reload. When the plugin cannot read its database the card says "Couldn't
read notes" with the reason, beside any notes it already showed.

## Reading and deleting a note

- Click a note's text on the card (or Tab to it and press Enter). The Spotlight
  opens titled "Note", read-only: the quoted passage with its source chip, then
  the note's words with each linked thread's "@Title" marked. There is no text
  box: notes cannot be edited. Esc, **Close** or a click outside closes it, and
  focus goes back to the row.
- **Delete** removes the note for good (there is no undo or trash), closes the
  Spotlight and shows a "Note deleted" toast; the row leaves the card without a
  reload and focus moves to the card's header. If deleting fails, the Spotlight
  stays open with one line saying why.
- A note deleted elsewhere (another window) while it is open closes the
  Spotlight there too. Deleting a note that is already gone succeeds.

## Where notes live

In the plugin's SQLite database, `data.db` under `~/.bb/plugins/notes/` (bb's
data directory). Attached files sit beside it in `media/`, one file per
attachment named by its id (`att_…`), and the browser reads them from the
plugin's route `/api/v1/plugins/notes/http/media?id=att_…` (local requests
only; Range is supported, so videos seek). Delete removes a note's files too.
When the plugin loads it removes files in `media/` that no note holds (left by
a save that failed), and logs how many. Notes survive `bb plugin reload
notes`, bb restarts and browser reloads. `bb plugin logs notes` shows the
plugin's server log, including the media folder's path.
