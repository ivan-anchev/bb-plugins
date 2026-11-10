# Agent guide

A monorepo of bb plugins published as one bb marketplace. Read the README's
development section first.

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
- **Unlist a plugin with `"bbMarketplace": { "listed": false }`** in its
  `package.json`. It leaves `marketplace.json` but stays in `.bb/plugins.json`,
  so it still installs directly from git.
- **Release by tag only.** Tags are `<id>/vX.Y.Z` and are never moved or
  reused. `npm run release -- <id>` creates one; pushing it is a deliberate,
  separate step.
- Document a plugin's commands and settings in its own `skills/` directory.

## Before you finish

Run `npm run check` (manifests in sync, typecheck, tests, `bb plugin build`, and
the same build from a standalone install of each plugin).
For behavior changes, also run the plugin live: `bb plugin install
./plugins/<id>` once, then `bb plugin dev plugins/<id>`.

On a remote machine (your checkout is under `~/.bb-machines/`), those commands
reach the user's bb server, which can't read your checkout. Live-test against a
throwaway local server instead: follow `docs/remote-live-testing.md`. Never run
`bb plugin install|dev|remove` there without its `local_bb` wrapper.

The plugin SDK contract is
`node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`. Run
`bb plugin types plugins/<id>` when the SDK pin drifts from the installed bb.
