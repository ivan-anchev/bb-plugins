---
name: notes
description: Explain the Notes plugin, which keeps short personal notes in bb in a Notes popover opened from the sidebar-footer Notes button, ⇧⌘J, or "Add to notes" on a chat message (a highlighted passage keeps a link to its message), with a composer at its bottom that links threads by typing @ and attaches images and videos by paste, drop or 📎, and the same list in a Notes card on the New thread screen, where a note opens in place with Delete and ticking some and choosing Start thread (or Add to composer on a thread page) puts them in the composer and archives them. Use when the user asks how to write, quote or link a note, how to read, edit or delete one, where their notes are, why ⇧⌘J does nothing, what the source chip opens, why a thread is missing from the @ picker, why a file was refused or where attached files are stored, what Start thread puts in the composer, why Start thread is disabled, where used notes went, why a file shows as a path instead of an attachment, why the Notes card is empty or says it couldn't read notes, where the card sits among the homepage cards, or why part of it stopped working after a bb update.
---

# Notes

The Notes plugin keeps the user's own short notes. It has no CLI commands, no
agent tools and no settings; an agent cannot read or write notes.

## The Notes popover

- Click **Notes** in the sidebar footer, or press ⇧⌘J (Ctrl+Shift+J off
  macOS), on any bb screen. A 384 × 560 popover opens beside the sidebar, its
  bottom level with the footer button. With the sidebar collapsed it opens at
  the window's bottom-left corner, 8px in. On a short window it takes the
  height there is.
- It holds the same list as the Notes card (below): a header with the count
  and a ×, the notes, a footer for Start thread while notes are ticked, and a
  composer at the bottom.
- The footer button and ⇧⌘J both toggle it. Esc first clears ticked notes,
  then closes it; a click outside closes it too. Closing with Esc, × or the
  shortcut puts focus back where it was (on the footer button when it opened
  the popover); a click outside leaves focus where the click put it.
- The footer button opens it with focus on the popover itself. ⇧⌘J, the
  card's **New note** link and **Add to notes** open it with the composer's
  field focused.

## Writing a note

- The composer at the bottom of the popover is always open, in bb's own
  composer style: the quote (if any), thumbs of attached files, a "Write a
  note…" textarea that grows upward, and a bar of 📎, @, the linked threads'
  chips and a round send button.
- Type, then press ⌘↵ (Ctrl+Enter) or click the send button (white with an up
  arrow once there is something to save, grey while empty). The note lands at the top
  of the list with a short highlight, in the popover and on the card; the form
  empties and keeps focus for the next one. An empty form does not save.
- Closing the popover drops what was typed (Esc, ×, a click outside).
- If saving fails, the form keeps the draft and one line says why.

## Saving a passage from a reply

- Highlight text in an assistant reply and choose **Add to notes** in the
  menu that appears over the selection. The popover opens with the form
  holding exactly the highlighted text as a quote and a source chip naming the
  thread. Typing is optional: ⌘↵ saves the quote on its own.
- **Add to notes** is also in the action bar under every message. On an
  assistant reply it quotes the whole reply, as its markdown source; on a
  user message it opens the form with no quote.
- The chip is bb's own thread mention for that message
  (`@thread:<id>#msg=<seq>`): clicking it opens the thread scrolled to the
  quoted message, from any screen. Checked live on bb 0.49.
- A note keeps the thread's title as it was when saved, so it still names its
  thread after the thread is renamed, archived or deleted. If the sidebar's
  threads have not loaded yet (or the thread is archived), the title is the
  thread's id.

## Linking threads with @

- Type `@` in the form (or click **@** in its bar) and a picker opens above
  the composer: "Link a thread", with up to five of the user's active threads
  whose title contains what follows the `@` (case-insensitive). Archived
  threads are not listed.
- ↑↓ move the highlight; Enter or Tab (or a click) writes "@Title " into the
  text and adds a chip in the bar naming the thread. With no match the picker
  says "No thread matches …", and Enter breaks the line as usual.
- Esc closes the picker only; it stays closed until what follows the `@`
  changes. A second Esc goes on to the popover.
- The text is what counts: a thread stays linked while its "@Title" is in the
  text. Editing or deleting that text unlinks it (its chip goes), and a chip's
  × removes every "@Title" of that thread. Typing a picked thread's "@Title"
  again by hand links it again.
- A saved note keeps each link as a range over its text. In the list, a note
  without a quote shows the first thread it links on line 2; a quote's thread
  still comes first.

## Attaching images and videos

- Paste a screenshot (⌘V) into the form, drop files on it (its edge lights up
  while a file is over it), or click 📎.
  Each file shows as a 40px thumb above the text, a video with a play badge;
  its × removes it.
- Taken: PNG, JPEG, GIF, WebP, MP4, MOV (`video/quicktime`) and WebM, up to
  100 MB each and 20 per note. Anything else is not added and one line says
  why: "HEIC isn’t supported — convert to PNG or JPEG", "rec.mov is over
  100 MB", "A note holds 20 files at most". SVG is refused because it can run
  script.
- A note can be just its files: the send button is enabled with files alone,
  and stays disabled while the files upload. The note is saved whole or not at
  all; if saving fails the draft keeps its files.
- In the list a note with no words and no quote reads "2 screenshots"
  (images), "1 recording" (videos) or "3 attachments" (both).

## The shortcut

The command is listed in Settings → Keyboard as "Plugin: notes · New note",
where it can be rebound. bb leaves a plugin's default unbound when it collides
with another binding, which is why the default is ⇧⌘J and not ⇧⌘N (bb desktop's
New window). If ⇧⌘J does nothing, check that row: another plugin may hold it.
bb runs no plugin shortcut while focus is inside the popover, so the popover
closes itself on ⇧⌘J; it knows only the default, so with a rebound shortcut
use Esc to close it.

## The list: card and popover

The Notes card is on the New thread screen, under the composer. With the
Homepage plugin's cards and PR Reviews installed, Notes sits on the second row:
beside boat spend (about 1 to 1.75) when boat-sandbox is installed, else beside
Burn, and in one column on a narrow page. Otherwise bb stacks it with the other
sections. The card takes its row's height (as tall as boat spend beside it),
never the number of notes; its list is at least four rows tall (184px).

Both the card and the popover list active notes newest first, in a box that
scrolls; its top and bottom edges fade only where there is more to scroll to.
Line 1 is the note on one line (a quote saved without words shows the quote in
“ ”), line 2 the thread the quote came from, else the first thread the note
links with @ ("No thread" for a note with neither). A note with files shows up
to three of them as small thumbs fanned at the row's end, "+N" for the rest; a
video shows its first frame with a play badge, or a plain tile with the badge
when the browser can't decode it (such as an HEVC or ProRes .mov). The fan
opens a little under the pointer, not on touch screens or with reduced motion
on. A new note appears within about two seconds with no reload. When the
plugin cannot read its database the list says "Couldn't read notes" with the
reason, beside any notes it already showed.

Each row has a checkbox for Start thread (below). It shows under the pointer,
on keyboard focus, once ticked, and on every row while any note is ticked;
on touch screens it always shows. Its column stays, so nothing shifts.

## Reading and deleting a note

- Click a note's lines or its thumbs (or Tab to it and press Enter): it opens
  in place under its row, in the card or the popover. It shows the quoted
  passage with its source chip, the note's words with each linked thread's
  "@Title" marked, then its images and videos, **Open thread** when it came
  from or links a thread, and **Delete**. A long note scrolls in its own box.
  Click again to fold it. Notes cannot be edited.
- A video plays and seeks in place; an image opens bb's lightbox, where ← → or
  the arrows step through all of the note's files, and Esc closes the lightbox
  only. HEVC videos (some iPhone recordings) may not play in bb's browser.
- **Open thread** opens the quote's thread, else the first linked thread.
- **Delete** removes the note for good (there is no undo or trash) and shows a
  "Note deleted" toast; the row leaves the card and the popover without a
  reload. If deleting fails, one line under the note says why. Deleting a note
  that is already gone succeeds.

## Starting a thread from notes

- Tick notes with their checkboxes. The footer reads "N selected · Clear" and
  **Start thread**; Clear unticks them all. The card and the popover keep
  their own ticks.
- Where the brief goes depends on the screen. On the New thread screen,
  **Start thread** adds it to bb's new-thread composer. On a thread page the
  popover's button reads **Add to composer** and adds it to that thread's
  draft. Elsewhere (Tools, Settings) the button is disabled and a line says
  "Open New thread or a thread to use notes." The popover closes after the
  brief is in and focus goes to the composer.
- The brief goes after anything already typed (the typed text, its pills and
  its attachments stay). It reads "Context from N notes:", then each note,
  oldest first: its passage as a quote with "— from @Thread
  (@thread:<id>#msg=<seq>)" (a pill for the thread, and bb's link to the
  message), then the user's words with their @ links as pills. Pills carry the
  thread titles saved with the note.
- The notes' images and videos become the draft's attachments, uploaded to the
  composer's project (a thread's own project on a thread page). A file over
  bb's 35 MB attachment limit is not attached; the brief names it instead as
  "Too large to attach, on disk: <path> (<name>)", the file in the plugin's
  `media/` folder.
- The draft is not sent: the user reviews and sends it. bb keeps it across
  reloads. With "No project" picked, the files go to bb's personal project;
  Start thread is disabled while bb is still resolving the composer's project.
- The notes used leave the list: they are archived, not deleted. Their rows and
  files stay in the database and `media/`, and there is no undo or view of
  archived notes yet.
- The notes are archived before the brief goes into the composer. If the brief
  or the archive fails, the composer is left as it was, the notes stay and stay
  ticked, and one line says "Couldn't start the thread: …". Starting again
  simply retries. Files uploaded for a failed try may stay in the project's
  attachment store; bb offers no way to remove them.

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

## Experimental

Most of the plugin rests on bb surfaces still marked `experimental_`: the
overlay the popover opens in (`experimental_appOverlay`), the sidebar footer
(`experimental_sidebarFooter`), the thread list behind the @ picker
(`experimental_useSidebarThreads`), a message's `experimental_messageSeq`
behind the source chip, and the rpc hooks, icons and image lightbox the card
and popover use. The popover finds the footer button by the
`data-footer-item` attribute bb puts on it, which is not part of the SDK. A bb
update can change or break them before the plugin catches up; it was built
against bb 0.49. If one stops working after an update, `bb plugin logs notes`
and the browser console are the first places to look.
