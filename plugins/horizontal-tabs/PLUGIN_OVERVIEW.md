Experimental: it may break with a bb update.

A tab strip across the top of bb's main panel, above every pane of a split. For now it holds one tab, the layout on screen. The tab is named after the focused pane's thread and shows the initials of the projects open in it. It follows bb as you focus another pane or resize one. Each pane keeps its own header below the strip.

## What you get

- **One row for the whole window.** The strip spans the main panel, over a single thread or a split of several, so every pane's own title, maximize and Close pane controls stay where they are, just below it.
- **A tab that follows bb.** Click into another pane and the tab takes that pane's thread title. Open another thread or drag a divider and the tab updates.
- **Where you are.** The tab is selected on a thread. On Settings, a plugin page or the New thread screen the strip stays, with no tab selected.

## How it works

bb has no place above its main panel, so the plugin adds the strip there itself and reads the layout bb keeps for the window. If a bb update changes either, the strip may stop showing or stop following until the plugin is updated. The strip is hidden on phone-width windows, where bb has no split. The plugin has no settings or commands yet.
