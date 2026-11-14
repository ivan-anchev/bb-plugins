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
| [`boat-sandbox`](plugins/boat-sandbox) | Experimental: it may break with a bb update. Run bb threads on on-demand boat.dev sandboxes, with template, environment and size choices. |
| [`bot-wake`](plugins/bot-wake) | Wakes your Grok Bots by webhook when a bb thread needs attention: an open question or approval, a finished turn, or a failure. |
| [`mdxcn`](plugins/mdxcn) | Agents draw [mdxcn](https://mdxcn.dev) figures in chat: callouts, steps, terminals, tables, KPIs, charts, timelines and more, from a fenced block. |
| [PR Reviews](plugins/pr-reviews) | Browse a GitHub project's open pull requests and review each change with its full diff and a step-by-step guided review. |
| [`proactive-visuals`](plugins/proactive-visuals) | Agents answer data with an inline chart, without being asked. |
| [`subagents-strip`](plugins/subagents-strip) | A live strip above the composer that counts the thread's subagents and child threads and opens into one row per subagent that expands to its report and latest steps. |

## Develop

```sh
npm install
npm run new -- my-plugin          # scaffold plugins/my-plugin with `bb plugin new`
bb plugin install ./plugins/my-plugin
bb plugin dev plugins/my-plugin   # rebuild and reload on save
npm run check                     # manifests, typecheck, tests, build, standalone build (what CI runs)
```
