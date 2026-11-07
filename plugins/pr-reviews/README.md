# PR Reviews

A **PR Reviews** app on bb's left rail that lists a GitHub project's open pull
requests and opens each one as a guided review. See `PLUGIN_OVERVIEW.md` for
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

## Develop

```sh
bb plugin install ./plugins/pr-reviews
bb plugin dev plugins/pr-reviews
```
