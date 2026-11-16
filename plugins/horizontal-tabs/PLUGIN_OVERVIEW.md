Experimental: it may break with a bb update.

Browser-style tabs across the top of bb's main panel, each holding a whole split layout. Clicking a tab brings back its panes at their exact sizes, with the same pane focused; if a bb update stops that, tabs switch with their panes side by side at equal sizes, and the strip says so once. `+` opens a tab on the New thread screen, and `×` or a middle-click closes one. Ctrl+Tab and Ctrl+Shift+Tab step through tabs and Alt+1–9 go to one, all rebindable. Clicking a thread in the sidebar goes to the tab that has it open, and a middle-click opens it in a new tab; Cmd/Ctrl-click still opens it in a split, as in bb. Each tab is named after its focused pane's thread and shows a stack of project tiles, one per thread, with the focused thread's in front. Each window keeps its tabs across reloads, and an archived or deleted thread leaves them. Each pane keeps its own header below the strip.

## What you get

- **One row for the whole window.** The strip spans the main panel, over a single thread or a split of several, so every pane's own title, maximize and Close pane controls stay where they are, just below it.
- **A layout per tab.** Keep a review split in one tab and a single thread in another, and switch between them in one click, sizes and focus intact.
- **Tabs from the keyboard.** Ctrl+Tab and Ctrl+Shift+Tab go to the next and previous tab, wrapping, and Alt+1 to Alt+9 go to tab 1 to 9. A web browser keeps Ctrl+Tab for its own tabs, so there use Alt+N or rebind them in Settings → Keyboard.
- **Threads from the sidebar.** Click a thread in bb's list or the Activity sidebar and you go to the tab that has it open, with its pane focused. A thread open in no tab replaces the focused pane, as in bb. Middle-click a thread to open it alone in a new tab. Cmd-click (Ctrl-click on Windows and Linux) keeps bb's own open in a split, and the tab keeps that split.
- **Tabs that follow bb.** Open a thread, split, drag a divider or close a pane the usual way, and the tab on screen keeps it.
- **Tabs that last.** Reload the window and its tabs come back, the one on screen included. A new window starts from the last tabs saved on this device, then keeps its own. Archive or delete a thread and its pane leaves your other tabs; a tab left with nothing closes.
- **Where you are.** The tab on screen is selected on a thread. On Settings, a plugin page or bb's own New thread screen the strip stays with no tab selected, and clicking the tab brings its layout back.

## How it works

bb has no place above its main panel and no way for a plugin to set a whole layout, so the plugin adds the strip itself and writes the layout bb keeps for the window. If a bb update moves the place the strip attaches to, the strip may stop showing until the plugin is updated. If it changes how bb keeps its layout, tabs still switch, rebuilt one pane at a time: their threads come back in order with the same pane focused, side by side at equal sizes, and the strip shows a dismissible "Exact layout restore unavailable; using equal splits" notice the first time. A pane maximized in a tab comes back unmaximized. Tabs are saved in the browser, per window, not on the bb server. The strip is hidden on phone-width windows, where bb has no split. The plugin has no settings.
