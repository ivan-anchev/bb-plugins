# bb-plugin-coordinator

Experimental: it may break with a bb update. Unlisted in the marketplace; it
installs directly from git.

A long-lived coordinating thread, started from a panel in bb's navigation rail.
See `PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/crew-board/SKILL.md` for how it behaves. The product name lives only in
`package.json`'s `bb.name`, read by `src/name.ts`; everything else is named for
its role.

## Layout

- `server.ts`, `app.tsx`: composition roots, registrations only.
- `src/contract.ts`: the rpc contract (`coordinators`, `primaryHost`,
  `startCoordinator`; tag `coordinators`).
- `src/model/role.ts`: the role a thread holds, and the ticket its metadata
  carries until it is bound.
- `src/server/`: `store.ts` holds every SQL statement (tables `roles`,
  `coordinators`); `spawn.ts` mints a ticket, spawns, and binds the thread on
  the spawn answer and on `thread.created`; `roles.ts` is the one `configure`
  callback; `tools/` the agent tools; `memory/` the memory files beside
  `data.db`.
- `src/app/panel/`: the nav panel, its list, and the New page around bb's
  new-thread composer.
- `skills/coordinating/`: the coordinating thread's playbook, selected only
  for it. `skills/crew-board/`: the user guide, selected for every thread.

## Develop

```sh
npm run typecheck
npm test
bb plugin build
```
