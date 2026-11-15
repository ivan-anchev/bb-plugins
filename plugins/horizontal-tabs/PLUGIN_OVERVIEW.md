Experimental: it may break with a bb update.

Browser-style tabs across the top of bb's main panel, each holding a whole split layout. Clicking a tab brings back its panes at their exact sizes, with the same pane focused. `+` opens a tab on the New thread screen, and `×` or a middle-click closes one. Each tab is named after its focused pane's thread and shows the initials of the projects open in it. Each pane keeps its own header below the strip.

## What you get

- **One row for the whole window.** The strip spans the main panel, over a single thread or a split of several, so every pane's own title, maximize and Close pane controls stay where they are, just below it.
- **A layout per tab.** Keep a review split in one tab and a single thread in another, and switch between them in one click, sizes and focus intact.
- **Tabs that follow bb.** Open a thread, split, drag a divider or close a pane the usual way, and the tab on screen keeps it.
- **Where you are.** The tab on screen is selected on a thread. On Settings, a plugin page or bb's own New thread screen the strip stays with no tab selected, and clicking the tab brings its layout back.

## How it works

bb has no place above its main panel and no way for a plugin to set a whole layout, so the plugin adds the strip itself and writes the layout bb keeps for the window. If a bb update changes either, the strip may stop showing or tabs may stop switching until the plugin is updated. A pane maximized in a tab comes back unmaximized. For now tabs last until the window reloads. The strip is hidden on phone-width windows, where bb has no split. The plugin has no settings or commands yet.
