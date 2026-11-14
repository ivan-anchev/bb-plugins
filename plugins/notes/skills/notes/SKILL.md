---
name: notes
description: Explain the Notes plugin, which saves short personal notes in bb from a Spotlight opened with ⇧⌘J or the sidebar-footer notes icon, and lists them in a Notes card on the New thread screen. Use when the user asks how to write a note, where their notes are, why ⇧⌘J does nothing, or why the Notes card is empty or says it couldn't read notes.
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

## The shortcut

The command is listed in Settings → Keyboard as "Plugin: notes · New note",
where it can be rebound. bb leaves a plugin's default unbound when it collides
with another binding, which is why the default is ⇧⌘J and not ⇧⌘N (bb desktop's
New window). If ⇧⌘J does nothing, check that row: another plugin may hold it.
Shortcuts do not run while a bb dialog is open, the Spotlight included.

## The Notes card

On the New thread screen, under the composer. It lists active notes newest
first, four at a time: line 1 is the note on one line, line 2 the thread it
came from ("No thread" for a note typed from scratch). "N more" shows the rest
and "Show fewer" folds them. A new note appears within about two seconds with
no reload. When the plugin cannot read its database the card says "Couldn't
read notes" with the reason, beside any notes it already showed.

## Where notes live

In the plugin's SQLite database, `data.db` under `~/.bb/plugins/notes/` (bb's
data directory). Notes survive `bb plugin reload notes`, bb restarts and
browser reloads. `bb plugin logs notes` shows the plugin's server log.
