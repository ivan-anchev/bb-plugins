Experimental: it may break with a bb update.

Jot a note from anywhere in bb without leaving what you are doing. Press ⇧⌘J, or click the notes icon in the sidebar footer, type a line, and press ⌘↵. Type @ to link a thread. Or highlight text in a reply and choose Add to notes to keep that passage with a link back to its message. Your notes wait in a Notes card on the New thread screen: click one to read it or delete it.

## What you get

- **A Spotlight for notes.** ⇧⌘J (Ctrl+Shift+J off macOS), or the notes icon in the sidebar footer, opens a small writing box in the middle of any bb screen. ⌘↵ saves and closes it with a "Saved to notes" toast; Esc closes it without saving and leaves you where you were. Rebind the shortcut in Settings → Keyboard under "Plugin: notes · New note".
- **@ links to threads.** Type @ and pick one of your threads with ↑↓ and Enter: its title goes into the note and a chip shows under it. Delete the title, or click the chip's ×, to unlink it.
- **Passages from replies.** Highlight text in an assistant reply and choose **Add to notes** in the selection menu: the Spotlight opens with the passage and a chip naming its thread, and ⌘↵ saves it, with or without a thought of your own. The chip opens the thread at that message. **Add to notes** in a message's action bar quotes the whole reply, or opens a blank note on your own message.
- **A Notes card on the New thread screen.** Your newest notes, four at a time: each note on one line (a passage saved on its own shows in quotation marks), with the thread it came from under it, or the first thread it links ("No thread" for a note with neither). "N more" shows the rest, "Show fewer" folds them again, and "New note" opens the Spotlight from the card.
- **Read or delete a note.** Click a note on the card and the Spotlight shows it read-only: the passage with its source chip, and your words with each linked thread marked. **Delete** removes it for good with a "Note deleted" toast. Notes are not edited; delete one and write it again.

## How it works

Notes live in the plugin's own SQLite database on the bb server, so they survive reloads and restarts and never leave your machine. The plugin needs no account or setting.

The Spotlight and the sidebar icon use bb surfaces that are still experimental, so a bb update can change or break them before the plugin catches up.
