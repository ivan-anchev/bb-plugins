---
name: notes
description: Explain the Notes plugin, which saves short personal notes in bb from a Spotlight opened with ⇧⌘J, the sidebar-footer notes icon, or "Add to notes" on a chat message (a highlighted passage keeps a link to its message), and lists them in a Notes card on the New thread screen. Use when the user asks how to write or quote a note, where their notes are, why ⇧⌘J does nothing, what the source chip opens, or why the Notes card is empty or says it couldn't read notes.
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

## The shortcut

The command is listed in Settings → Keyboard as "Plugin: notes · New note",
where it can be rebound. bb leaves a plugin's default unbound when it collides
with another binding, which is why the default is ⇧⌘J and not ⇧⌘N (bb desktop's
New window). If ⇧⌘J does nothing, check that row: another plugin may hold it.
Shortcuts do not run while a bb dialog is open, the Spotlight included.

## The Notes card

On the New thread screen, under the composer. It lists active notes newest
first, four at a time: line 1 is the note on one line (a quote saved without
words shows the quote in “ ”), line 2 the thread the quote came from ("No
thread" for a note typed from scratch). "N more" shows the rest
and "Show fewer" folds them. A new note appears within about two seconds with
no reload. When the plugin cannot read its database the card says "Couldn't
read notes" with the reason, beside any notes it already showed.

## Where notes live

In the plugin's SQLite database, `data.db` under `~/.bb/plugins/notes/` (bb's
data directory). Notes survive `bb plugin reload notes`, bb restarts and
browser reloads. `bb plugin logs notes` shows the plugin's server log.
