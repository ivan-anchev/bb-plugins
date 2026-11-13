# bb-plugin-activity-sidebar

Replaces bb's thread list with one Activity list of every parent thread from
every project, latest first, with pinned threads above it and the Working,
Asleep and Archived shelves folded at its foot. A filter narrows it to one
project. Each row shows the thread's agent, its project's coloured initial, its
title, how many threads run under it, and its state or how long ago it last
moved. Right-click a row for its menu (rename, pin, copy, sleep or wake,
archive, delete); under the pointer, its corner offers Archive. A thread put to
sleep waits on Asleep until its time, then comes back to the top.

Unlisted while it is built in slices; install it from this repository.

## Develop

```sh
bb plugin install ./plugins/activity-sidebar   # once
bb plugin dev plugins/activity-sidebar         # rebuild and reload on save
npm test --workspace plugins/activity-sidebar
```

The plugin takes bb's exclusive thread-list slot, so it replaces the sidebar of
the bb you install it on. Try it on a throwaway server
(`docs/remote-live-testing.md`) unless you mean to switch your own.

## Layout

- `src/model/`: pure rules, from bb's live threads to sections and rows.
- `src/list/`: pure flattening into list items and their computed layout.
- `src/contract.ts`: the app/server RPC contract and its one record, a sleep.
- `src/server/`: the sleeps' SQLite store and their RPC handlers.
- `src/data/`: the clock, the sleeps read and writes, and the reader's choices
  kept in local storage.
- `src/ui/`: the slot component, the windowed scroller and the shelf titles.
- `src/ui/row/`: the row, its menu and its rename field.
