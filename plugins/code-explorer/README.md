# Code Explorer

Colored file-type icons on file links and `@file` mentions in bb's chat. See
`PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/code-explorer/SKILL.md` for what the plugin changes.

## Install

```sh
bb marketplace add git:github.com/ivan-anchev/bb-plugins@main
bb plugin install code-explorer@ivan-anchev
```

## Credits

The icons are the built-in `complete` colored icon set of
[`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees) (Apache-2.0).
`src/chat-file-icons.css` copies its icon palette and per-type colors, which
the package does not export.

## Develop

From the repository root:

```sh
npm install
npm run check
bb plugin install ./plugins/code-explorer
bb plugin dev plugins/code-explorer
```

`npm test` in this directory runs the unit tests with `node --test`.
