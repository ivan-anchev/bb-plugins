# bb-plugin-notes

Experimental: it may break with a bb update.

Personal notes in bb: a Spotlight opened with ⇧⌘J or the sidebar-footer notes
icon, and a Notes card on the New thread screen. See `PLUGIN_OVERVIEW.md` for
the user-facing description and `skills/notes/SKILL.md` for how it behaves.

## Layout

- `server.ts`, `app.tsx`: composition roots, registrations only.
- `src/contract.ts`: the note's zod schemas and the rpc contract (tag `notes`).
- `src/server/`: `store.ts` holds every SQL statement; `notes.ts` writes and
  deletes notes and invalidates the `notes` tag.
- `src/app/use-notes.ts`: the one read of the notes list, shared by the card and
  the Spotlight.
- `src/app/spotlight/`: the Spotlight, an `experimental_appOverlay` over a small
  module store (`spotlight-store.ts`) that every opener calls; `compose/` writes
  a note, `view/` shows a saved one with Delete.
- `src/app/home/`: the homepage card and its rows.
- `src/app/ui/`: helpers copied from pr-reviews and boat-sandbox, because every
  plugin installs standalone.

## Development

```sh
npm run typecheck
npm test
bb plugin install ./plugins/notes   # once, from the repo root
bb plugin dev plugins/notes
```
