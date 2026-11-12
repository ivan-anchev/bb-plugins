# PR Reviews

A **PR Reviews** app on bb's left rail that lists your pull requests across
every GitHub project, in sections with stacks as trees, and opens each one as
a guided review. See `PLUGIN_OVERVIEW.md` for
the user-facing description and `skills/pr-reviews/SKILL.md` for what the app
shows.

## Requirements

The GitHub CLI, installed and signed in (`gh auth login`) on the machine that
runs bb.

## Install

```sh
bb marketplace add git:github.com/ivan-anchev/bb-plugins@main
bb plugin install pr-reviews@ivan-anchev
```

## Credits

The file tree and its icons are [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees)
(Apache-2.0). The path filter matches with [`picomatch`](https://www.npmjs.com/package/picomatch)
(MIT). The change kind rules in `src/guide/change-kind.ts` are ported from
[T3 Code](https://github.com/pingdotgg/t3code)'s
`packages/shared/src/changedFileKind.ts` (MIT, © 2026 T3 Tools Inc.).

## Develop

```sh
bb plugin install ./plugins/pr-reviews
bb plugin dev plugins/pr-reviews
```
