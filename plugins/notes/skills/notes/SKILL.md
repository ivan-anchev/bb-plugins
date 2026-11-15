---
name: notes
description: Explain the Notes plugin, which keeps short personal notes in bb in a Notes popover opened from the sidebar-footer Notes button, ⇧⌘J, or "Add to notes" on a chat message (a highlighted passage keeps a link to its message), with a composer at its bottom that links threads by typing @ and attaches images and videos by paste, drop or 📎, and the same list in a Notes card on the New thread screen, where clicking a note ticks it and ticking some lets the user delete them with one click or choose New thread (from any screen, or ⌘↵) or, on a thread page, Send to this thread (its ▾ menu, or ⇧⌘↵) to put them in that composer, where they wait marked In draft until that message is sent, which deletes them. Use when the user asks how to write, quote or link a note, how to tick, read, edit or delete one, where their notes are, why ⇧⌘J does nothing, what the source chip opens, why a thread is missing from the @ picker, why a file was refused or where attached files are stored, what New thread or Send to this thread puts in the composer, why there is no ▾ menu or Send to this thread, what ⌘↵ or ⇧⌘↵ does in the Notes panel, what In draft means, where used notes went or why they are still there, why a file shows as a path instead of an attachment, why the Notes card is empty or says it couldn't read notes, where the card sits among the homepage cards, or why part of it stopped working after a bb update.
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
  and a ×, the notes, a footer for Delete and New thread while notes are
  ticked, and a composer at the bottom.
- The footer button and ⇧⌘J both toggle it. Esc first closes the @ picker,
  then closes the New thread ▾ menu, then clears ticked notes, then closes it; a click outside closes it too. Closing with Esc, × or the
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

## Ticking notes

- A click anywhere on a row (its lines, its thumbs, the space between) ticks
  the note for Delete and New thread (below); another click unticks it. Its
  checkbox, on the row's first line, does the same.
  Dragging over a row's text to select it does not tick it.
- The checkbox shows under the pointer, on keyboard focus, once ticked, and on
  every row while any note is ticked; on touch screens it always shows. Its
  column stays, so nothing shifts.
- From the keyboard, Tab reaches each row's checkbox and Space ticks it.
- A note does not open: the list shows its first line and its thumbs only,
  and notes cannot be edited. Its full text and files go into the composer
  with New thread or Send to this thread.

## Deleting notes

- Tick the notes to delete. The footer reads "N selected · Clear", then
  **Delete** apart from **New thread ▾** at its right.
- One click on Delete deletes every ticked note and its files, for good
  (there is no undo, trash or confirm step), in one go however many are
  ticked, and shows "Note deleted" or "N notes deleted".
- Focus goes to the list as Delete is clicked, and stays there. The deleted
  rows leave the card and the popover without a reload and the ticks clear.
  While deleting, the footer's controls, the rows and Esc wait for it, so the ticks stay as sent; if deleting
  fails, the notes stay, one line says "Couldn't delete: …" and the controls
  work again. Deleting a note already gone succeeds.

## Starting a thread from notes

- Tick notes by clicking their rows. The footer reads "N selected · Clear" and
  **New thread**; on a thread page it is a split button, **New thread ▾**.
  Clear unticks them all. The card and the popover keep their own ticks.
- **New thread** (the button, or the first row of its ▾ menu) adds the brief
  to bb's new-thread composer from any screen. On the New thread screen it
  fills the composer there. From a thread page, Tools or Settings, bb first
  goes to the New thread screen (the popover stays open meanwhile), then fills
  its composer; whatever the user had drafted there stays.
- **Send to this thread**, in the ▾ menu, adds the brief to the draft of the
  thread on screen and stays on the page. Where no thread is on screen (the
  New thread screen, Tools, Settings) it is not possible, so the footer shows
  New thread alone, with no chevron and no menu.
- The ▾ menu works from the keyboard: Enter, Space or ↓ on the chevron opens
  it, ↑ ↓ move, Enter picks, and Esc closes it and puts focus back on the
  chevron. The next Esc clears the ticks. Each row shows its shortcut.
- **Shortcuts**, while notes are ticked and focus is inside the Notes panel
  (card or popover) but not in a text field: ⌘↵ (Ctrl+Enter) runs New thread,
  ⇧⌘↵ or ⌥⌘↵ runs Send to this thread where it is possible. They act as a
  click would. In the popover's composer ⌘↵ still saves the note, and bb's own
  composer is untouched; with nothing ticked, or while a start or a delete
  runs, they do nothing.
- While a start runs, the rows, Clear, Delete, the split button and Esc
  wait for it, so the ticks stay as sent. The popover closes once the brief is
  in, and focus goes to the composer.
- The brief goes after anything already typed (the typed text, its pills and
  its attachments stay). It reads "Context from N notes:", then each note,
  oldest first: its passage as a quote with "— from @Thread
  (@thread:<id>#msg=<seq>)" (a pill for the thread, and bb's link to the
  message), then the user's words with their @ links as pills. Pills carry the
  thread titles saved with the note.
- The notes' images and videos become the draft's attachments, uploaded to the
  composer's project (a thread's own project on a thread page). A file over
  bb's 35 MB attachment limit is not attached; the brief names it instead as
  "Too large to attach, on disk: <path> (<name>)". The path is in the plugin's
  `kept/` folder, beside `media/`, so it still works after the message's send
  deletes the note. Notes never removes files from `kept/`: they accumulate
  until the user deletes them by hand.
- The draft is not sent: the user reviews and sends it. bb keeps it across
  reloads. With "No project" picked, the files go to bb's personal project.
  While bb is still resolving the new-thread composer's project, New thread
  waits for it.
- The notes used stay on the list, marked "In draft" under their text, while
  that composer's draft holds the brief. bb keeps drafts across reloads, and so
  does the mark (it is stored in `data.db`).
- Sending a message from that composer that still holds the brief, word for
  word, deletes those notes and their files for good, as Delete does. There is
  no undo. A queued message counts as sent once bb accepts it.
- Taking the brief out of the draft, editing any of its text, or clearing the
  draft clears the mark and keeps the notes; sending the rest deletes nothing.
  The mark clears only when a bb window saw the brief in that composer's draft
  and then saw it go, so another window with a different draft for the same
  composer leaves it alone. A draft left on another thread keeps its notes
  marked until it is next opened.
- If the marks can't be read, the panel says "Couldn't read which notes are in
  a draft: …" with **Retry**, and bb shows an error. Sending still deletes the
  notes: the server checks the sent draft against its own marks.
- A note waits in one draft at a time: starting with it again moves its mark to
  the newer draft, and only a send from there deletes it.
- The notes are marked before the brief goes into the composer. If the brief or
  the mark fails, the composer is left as it was, the notes stay and stay
  ticked, and one line says "Couldn't start the thread: …". Starting again
  simply retries. Files uploaded for a failed try may stay in the project's
  attachment store; bb offers no way to remove them.
- Notes an older version of the plugin archived when starting a thread stay in
  the database and `media/`, off the list.

## Where notes live

In the plugin's SQLite database, `data.db` under `~/.bb/plugins/notes/` (bb's
data directory). Attached files sit beside it in `media/`, one file per
attachment named by its id (`att_…`); files a brief named by path also sit in
`kept/` (see above), and the browser reads them from the
plugin's route `/api/v1/plugins/notes/http/media?id=att_…` (local requests
only; Range is supported, so videos seek). Delete removes the notes' files too.
When the plugin loads it removes files in `media/` that no note holds (left by
a save that failed), and logs how many. Notes survive `bb plugin reload
notes`, bb restarts and browser reloads. `bb plugin logs notes` shows the
plugin's server log, including the media folder's path.

## Experimental

Most of the plugin rests on bb surfaces still marked `experimental_`: the
overlay the popover opens in (`experimental_appOverlay`), the sidebar footer
(`experimental_sidebarFooter`), the thread list behind the @ picker
(`experimental_useSidebarThreads`), a message's `experimental_messageSeq`
behind the source chip, and the rpc hooks and icons the card
and popover use. The popover finds the footer button by the
`data-footer-item` attribute bb puts on it, which is not part of the SDK. A bb
update can change or break them before the plugin catches up; it was built
against bb 0.49. If one stops working after an update, `bb plugin logs notes`
and the browser console are the first places to look.
