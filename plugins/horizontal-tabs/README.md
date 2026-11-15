# Horizontal Tabs

A tab strip across the top of bb's main panel. See `PLUGIN_OVERVIEW.md` for the
user-facing description and `skills/horizontal-tabs/SKILL.md` for what the strip
shows.

## Layout

- `src/model/`: bb's split layout (`layout.ts`, with bb's own schema) and the
  window's tabs (`tab-set.ts`, with the open, switch and close reducers, the
  keyboard's step and nth, locate for sidebar clicks, and prune for archived
  threads). Pure, except `saved.ts`, which keeps the tabs in sessionStorage and
  localStorage across reloads (`json.ts` reads stored JSON for it and for bb's
  layout).
- `src/controller/`: the one owner of the tabs (`tabs-controller.ts`), this
  window's instance (`tabs.ts`), and the keyboard commands that drive it
  (`commands.ts`).
- `src/host/`: everything that reaches into bb outside the SDK, each with a
  `why:` comment: bb's layout atom, found in bb's loaded chunks
  (`layout-atom.ts`); reading and showing bb's layout through it
  (`host-layout.ts`); the strip's slot in bb's DOM (`strip-mount.ts`); and
  sidebar row clicks, routed into tabs before bb routes them
  (`sidebar-clicks.ts`, with the pure rule for which clicks it takes in
  `sidebar-gesture.ts`).
- `src/ui/`: the app overlay that feeds bb's changes to the controller and
  portals the strip into the slot, and the strip itself.

## Develop

From the repository root:

```sh
npm install
npm run check
bb plugin install ./plugins/horizontal-tabs
bb plugin dev plugins/horizontal-tabs
```
