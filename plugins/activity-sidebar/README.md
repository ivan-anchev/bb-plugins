# bb-plugin-activity-sidebar

Replaces bb's thread list with one Activity list of every parent thread from
every project, latest first, with pinned threads above it. Each row shows the
thread's agent, its project's coloured initial, its title, how many threads run
under it, and its state or how long ago it last moved.

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
- `src/ui/`: the slot component, the windowed scroller and the row.
