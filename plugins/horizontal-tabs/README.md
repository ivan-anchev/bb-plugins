# Horizontal Tabs

A tab strip across the top of bb's main panel. See `PLUGIN_OVERVIEW.md` for the
user-facing description and `skills/horizontal-tabs/SKILL.md` for what the strip
shows.

## Layout

- `src/model/`: bb's split layout (`layout.ts`, with bb's own schema) and the
  window's tabs (`tab-set.ts`). Pure.
- `src/controller/`: the one owner of the tabs (`tabs-controller.ts`) and this
  window's instance (`tabs.ts`).
- `src/host/`: everything that reaches into bb outside the SDK, each with a
  `why:` comment: reading bb's layout (`host-layout.ts`) and the strip's slot in
  bb's DOM (`strip-mount.ts`).
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
