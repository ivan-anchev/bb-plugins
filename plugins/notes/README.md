# bb-plugin-notes

Experimental: it may break with a bb update.

Personal notes in bb: a Notes popover opened from the sidebar footer or with
⇧⌘J, and the same list as a Notes card on the New thread screen. See `PLUGIN_OVERVIEW.md` for
the user-facing description and `skills/notes/SKILL.md` for how it behaves.

## Layout

- `server.ts`, `app.tsx`: composition roots, registrations only.
- `src/contract.ts`: the note's zod schemas and the rpc contract (tag `notes`).
- `src/server/`: `store.ts` holds every SQL statement; `notes.ts` writes and
  deletes notes with their files and invalidates the `notes` tag; `media/`
  keeps attachment files beside `data.db` and serves them at `GET /media?id=`
  with Range.
- `src/app/use-notes.ts`: the one read of the notes list, shared by the card and
  the popover. `src/app/media-url.ts`: where the browser reads a file.
  `src/app/quote-block.tsx`: a quoted passage and its source chip.
- `src/app/panel/`: the Notes panel both hosts render: header, the scrolling
  list (`list/`), a note opened in place (`detail/`), the picks, deleting
  them, and starting from them (`start/`): New thread from any screen, and
  on a thread page a split button that adds Send to this thread; ⌘↵ and
  ⇧⌘↵ run them from the panel.
- `src/app/popover/`: the popover, an `experimental_appOverlay` over a small
  module store (`popover-store.ts`) that every opener calls, anchored beside
  the sidebar-footer button (`footer-anchor.ts`).
- `src/app/compose/`: the popover's inline form: @ links, files, save.
- `src/app/home/`: the homepage card, the panel in card chrome.
- `src/app/ui/`: small helpers (Esc holding, focus hand-off, the shortcut, the
  icon), some copied from pr-reviews and boat-sandbox, because every plugin
  installs standalone.

## Development

```sh
npm run typecheck
npm test
bb plugin install ./plugins/notes   # once, from the repo root
bb plugin dev plugins/notes
```
