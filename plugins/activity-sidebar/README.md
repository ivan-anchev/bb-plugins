# Activity Sidebar

Experimental: it may break with a bb update. It relies on bb's experimental plugin APIs.

Replaces bb's thread list with one Activity list of every parent thread from
every project, latest first, with pinned threads above it and the Working,
Asleep and Archived shelves folded at its foot. A filter narrows it to one
project, and rows are one line or two. Each row shows the thread's agent, its
project's coloured initial, its title, its pull request, how many threads run
under it, and its state or how long ago it last moved. Right-click a row for
bb's own thread menu, with Sleep (or Wake) added; under the pointer, its corner
offers Archive. A thread put to sleep waits on Asleep until its time,
then comes back to the top. Rest on a row for its card, with its plan while it
works and a tree of its subthreads. See `PLUGIN_OVERVIEW.md` for the full
description and `skills/activity-sidebar/SKILL.md` for how each part behaves.

## Install

```sh
bb marketplace add git:github.com/ivan-anchev/bb-plugins@main
bb plugin install activity-sidebar@ivan-anchev
```

It takes bb's thread-list slot, so it replaces the sidebar of the bb you install
it on. To go back to bb's own list, pick it under Settings → Appearance →
Sidebar.

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
- `src/data/`: the clock, the sleeps read and writes, what a thread asks, a
  working thread's plan, and the reader's choices kept in local storage.
- `src/data/pull-request/`: a row's pull request, read from bb's GitHub PR Status plugin.
- `src/ui/`: the slot component, the windowed scroller and the shelf titles.
- `src/card/`: the hover card's pure rules: when it shows (`CardIntent`), its
  state line, its plan's fold, and its subthread tree.
- `src/ui/row/`: the row, its menu, its pull request badge and its rename field.
- `src/ui/card/`: the hover card, its body, its plan and its subthread tree.
