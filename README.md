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
| [Activity Sidebar](plugins/activity-sidebar) | Experimental: it may break with a bb update. One Activity list of every parent thread from every project in place of bb's thread list, with Working, Asleep and Archived shelves, sleep, and a hover card per thread. |
| [`boat-sandbox`](plugins/boat-sandbox) | Experimental: it may break with a bb update. Run bb threads on on-demand boat.dev sandboxes, with template, environment and size choices. |
| [`bot-wake`](plugins/bot-wake) | Wakes your Grok Bots by webhook when a bb thread needs attention: an open question or approval, a finished turn, or a failure. |
| [`homepage`](plugins/homepage) | A grid of cards under the new-thread composer, starting with Activity: six months of your merged GitHub PRs, with threads started, PRs merged and lines changed. With Burn installed, a card with your spend and tokens for the week or month. |
| [Horizontal Tabs](plugins/horizontal-tabs) | Experimental: it may break with a bb update. Browser-style tabs across the top of bb's main panel, each holding a whole split layout that comes back at its exact sizes when you click the tab; `+` opens a tab, `×` or a middle-click closes one, Ctrl+Tab or Alt+1–9 switch, a middle-click on a sidebar thread opens it in a new tab, and each window keeps its tabs across reloads. |
| [`mdxcn`](plugins/mdxcn) | Agents draw [mdxcn](https://mdxcn.dev) figures in chat: callouts, steps, terminals, tables, KPIs, charts, timelines and more, from a fenced block. |
| [Notes](plugins/notes) | Experimental: it may break with a bb update. Jot a note from anywhere in bb with ⇧⌘J or the sidebar-footer notes icon, or save a passage from a reply, with @ thread links and screenshots or recordings. A Notes card on the New thread screen turns the notes you tick into the start of a new thread. |
| [Office Quote](plugins/office-quote) | Experimental: it may break with a bb update. A daily The Office quote above the new-thread composer, with the character who said it. |
| [PR Reviews](plugins/pr-reviews) | Browse a GitHub project's open pull requests and review each change with its full diff and a step-by-step guided review. |
| [`proactive-visuals`](plugins/proactive-visuals) | Agents answer data with an inline chart, without being asked. |
| [Regional Manager](plugins/regional-manager) | Experimental: it may break with a bb update. A regional manager is a long-lived thread that plans a body of work as issues, keeps its memory in files, and starts an agent thread on each issue, on this machine or in a sandbox; all of its agents are its crew. An independent verifier checks every done handoff, and a board shows each issue by status, with Needs you above, its pull request and CI. |
| [`subagents-strip`](plugins/subagents-strip) | A live strip above the composer that counts the thread's subagents and child threads and opens into one row per subagent that expands to its report and latest steps. |

## Themes

Custom bb themes, plain CSS rather than plugins, live in [`themes/`](themes),
with a one-command download for each.

## Develop

```sh
npm install
npm run new -- my-plugin          # scaffold plugins/my-plugin with `bb plugin new`
bb plugin install ./plugins/my-plugin
bb plugin dev plugins/my-plugin   # rebuild and reload on save
npm run check                     # manifests, typecheck, tests, build, standalone build (what CI runs)
```
