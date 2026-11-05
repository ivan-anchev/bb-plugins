# bb-plugins

Ivan Anchev's [bb](https://getbb.app) plugins, one per directory, published as
a bb marketplace.

## Install

Add the marketplace once, then install plugins from **Extensions → Browse
plugins**:

```sh
bb marketplace add git:github.com/ivan-anchev/bb-plugins@main
bb plugin install <id>@ivan-anchev
```

Or install one plugin directly, without the marketplace:

```sh
bb plugin install git:https://github.com/ivan-anchev/bb-plugins.git@^0.1.0 --tag-prefix <id>/ --plugin <id>
```

## Plugins

| Plugin | What it does |
| --- | --- |
| [`comfortable-type`](plugins/comfortable-type) | A theme that sets bb's text at 14px in the system font, with bb's own colors. |
| [`file-tree`](plugins/file-tree) | Browse the environment's files and git changes as a tree with colored per-file-type icons, and read any file or its diff beside the tree. |
| [`proactive-visuals`](plugins/proactive-visuals) | Agents answer data with an inline chart, without being asked. |

## Repository layout

| Path | What it is |
| --- | --- |
| `plugins/<id>/` | One self-contained plugin. Its `package.json` is the single source of truth for its name, description, icon, tags, and version. |
| `.bb/plugins.json` | Collection index behind `bb plugin install … --plugin <id>`. **Generated.** |
| `marketplace.json` | Marketplace catalog behind `bb marketplace add`. **Generated.** |
| `schema/` | bb's official JSON schemas, vendored, so validation runs offline. |
| `scripts/` | `new`, `manifests`, and `release`, the repo's three commands. |

Never edit the two generated files by hand: change the plugin's `package.json`
and run `npm run manifests`. CI fails when they are out of date.

## Develop

```sh
npm install
npm run new -- my-plugin          # scaffold plugins/my-plugin with `bb plugin new`
bb plugin install ./plugins/my-plugin
bb plugin dev plugins/my-plugin   # rebuild and reload on save
npm run check                     # manifests, typecheck, tests, build (what CI runs)
```

How each plugin field maps into the marketplace:

| `plugins/<id>/package.json` | Marketplace entry |
| --- | --- |
| `name` (`bb-plugin-<id>`) | `id` (must match the directory name) |
| `bb.name`, `bb.description` | `displayName`, `description` |
| `bb.branding.icon` | `icon` (named icon, or a file path relative to the plugin) |
| `keywords` (minus `bb-plugin`) | `tags` |
| `version` major | `range` (`0.x`, `1.x`, …) over `<id>/vX.Y.Z` tags |

## Release

`main` is protected: every change lands through a pull request with green CI.
Bump `version` in the plugin's `package.json`, run `npm run manifests`, and
merge that PR. Then tag the merged commit:

```sh
git switch main && git pull
npm run release -- <id>       # tags <id>/v<version> on HEAD
git push origin <id>/v<version>
```

The marketplace tracks each plugin's whole major line, so a pushed tag reaches
users on their next `bb plugin update` with no catalog change. bb refuses a tag
that moves after release: publish fixes as a new version, never retag.
