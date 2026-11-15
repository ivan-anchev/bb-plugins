Cards under the new-thread composer, so starting a thread also shows where your work stands. The first card is **Activity**: six months of your GitHub work at a glance. With the PR Reviews plugin installed, its **pull requests** card sits beside Activity, and the two stack when the window is narrow. With the Burn plugin installed, a **Burn** card shows what your agents spent and how many tokens they used over the last week or month.

## What you get

- **Activity: a six-month grid.** One square per day, one column per week, shaded by how many of your PRs merged that day. Shades use your theme's accent colour, so the card follows your theme. Today's square has a faint ring.
- **Activity: totals underneath.** Bottom left: the threads you started, PRs merged and lines changed in those six months. Bottom right: the months the grid covers, such as "May – Nov".
- **Each day on hover.** Hover a square, or tab into the grid and use the arrow keys, to read the day: "Thu, Nov 5 · 3 PRs merged · 1,204 lines".
- **Burn: spend and tokens.** Spent and Tokens for the last 7 or 30 days, picked with a Week/Month switch, each with its change against the 7 or 30 days before: "▲ 125%" when it went up, "▼ 12%" when it went down. Hover a change to read it in full, such as "▲ 125% vs previous 7 days".
- **No wait.** Activity opens with its last saved data, which the plugin refreshes in the background. Burn's card loads the week and the month together, so the switch never waits.

## How it works

For Activity, the plugin's server reads your merged PRs with the GitHub CLI you are already signed in to (`gh`), across every repository, not just the ones in bb. It also counts the threads you started yourself; subagent and forked threads are left out. It saves the result in the plugin's own storage when the bb server starts and every 30 minutes after, and the card updates when a refresh lands.

For Burn, the plugin asks the [Burn](https://github.com/kalindudc/burn) plugin for its numbers across every project each time the card shows, and again every minute while it stays open. Week and Month are rolling: the last 7 and 30 days, not the calendar week or month.

Activity needs `gh` installed and signed in. Without it, the card says which one is missing. The Burn card needs Burn installed and turned on; without it, the card says so. The plugin has no settings or commands.
