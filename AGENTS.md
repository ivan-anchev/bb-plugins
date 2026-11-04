# Agent guide

A monorepo of bb plugins published as one bb marketplace. Read the README's
layout and release sections first.

## Rules

- **One plugin per `plugins/<id>/` directory.** The directory name equals the
  id bb derives from the package name (`bb-plugin-<id>`).
- **`package.json` is the source of truth.** `.bb/plugins.json` and
  `marketplace.json` are generated: change the plugin's `package.json`, then run
  `npm run manifests`. Never hand-edit the generated files.
- **Every plugin must install standalone.** bb runs `npm install --omit=dev`
  inside the plugin directory with no workspace around it, so no
  `workspace:`, `catalog:`, `file:`, or `link:` dependencies, and nothing
  imported from another plugin or from the repo root. Runtime imports go in
  `dependencies`; types and tooling go in `devDependencies`.
- **Create plugins with `npm run new -- <id>`.** It runs `bb plugin new`, adopts
  the result into this repo, and regenerates the manifests.
- **Keep `bb.description` and `PLUGIN_OVERVIEW.md` in agreement.** They are one
  claim in two lengths; change both in the same commit.
- **Release by tag only.** Tags are `<id>/vX.Y.Z` and are never moved or
  reused. `npm run release -- <id>` creates one; pushing it is a deliberate,
  separate step.
- Document a plugin's commands and settings in its own `skills/` directory.

## Before you finish

Run `npm run check` (manifests in sync, typecheck, tests, `bb plugin build`).
For behavior changes, also run the plugin live: `bb plugin install
./plugins/<id>` once, then `bb plugin dev plugins/<id>`.

The plugin SDK contract is
`node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`. Run
`bb plugin types plugins/<id>` when the SDK pin drifts from the installed bb.
