Cards under the new-thread composer, so starting a thread also shows where your work stands. The first card is **Activity**: six months of your GitHub work at a glance. With the PR Reviews plugin installed, its **pull requests** card sits beside Activity, and the two stack when the window is narrow.

## What you get

- **Activity: a six-month grid.** One square per day, one column per week, shaded by how many of your PRs merged that day. Shades use your theme's accent colour, so the card follows your theme. Today's square has a faint ring.
- **Activity: totals underneath.** Bottom left: the threads you started, PRs merged and lines changed in those six months. Bottom right: the months the grid covers, such as "May – Nov".
- **Each day on hover.** Hover a square, or tab into the grid and use the arrow keys, to read the day: "Thu, Nov 5 · 3 PRs merged · 1,204 lines".
- **No wait.** Cards open with their last saved data, which the plugin refreshes in the background.

## How it works

For Activity, the plugin's server reads your merged PRs with the GitHub CLI you are already signed in to (`gh`), across every repository, not just the ones in bb. It also counts the threads you started yourself; subagent and forked threads are left out. It saves the result in the plugin's own storage when the bb server starts and every 30 minutes after, and the card updates when a refresh lands.

Activity needs `gh` installed and signed in. Without it, the card says which one is missing. The plugin has no settings or commands.
