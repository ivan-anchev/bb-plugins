---
name: horizontal-tabs
description: Explain the Horizontal Tabs plugin's tab strip at the top of bb's main panel, where each tab holds a whole split layout. Use when the user asks what a tab holds or shows, how to open, switch or close tabs, why a tab's title or project initials changed, why no tab is selected, why a maximized pane came back unmaximized, or why the strip is missing.
---

# Horizontal Tabs

Horizontal Tabs adds one row of tabs across the top of bb's main panel, above
every pane, like a browser's tabs. Each tab holds a whole layout: one thread, or
a split of several with its exact pane sizes. Each pane keeps its own header
(title, menu, maximize, Close pane) just below the strip. The plugin is
experimental: a bb update may break it.

## What a tab shows

- **Title:** the thread in the tab's focused pane, the one the sidebar
  highlights while the tab is on screen. Hover the tab for the full title when
  it is cut short. A tab opened with `+` reads "New thread" until a thread is
  created there.
- **Project initials:** one coloured tile per project with a thread open in the
  tab, in pane order, coloured as in the Activity sidebar.

## Using tabs

- **Switch:** click a tab. bb shows its layout at once, with the same panes, the
  same sizes and the same focused pane, and opens that pane's thread.
- **New tab:** `+` at the end of the strip opens a tab right of the current one
  on the New thread screen. Send the first message there and the tab becomes
  that thread.
- **Close:** hover a tab and click its `×`, or middle-click the tab. Closing the
  tab on screen shows the tab to its right, or to its left when it was the last
  one. The only tab left can't be closed, so it has no `×`.
- **Change what a tab holds** with bb as usual: open a thread from the sidebar,
  the palette or a link, split, drag a divider, close a pane. The tab on screen
  keeps whatever bb shows, and shows it again when you come back to it.

## No tab selected

On Settings, a plugin page or bb's own New thread screen (its sidebar button),
the strip stays and no tab is selected. Those screens don't change the tab
that was on screen: click it to get its layout back.

## What a tab doesn't keep

- **Maximize:** switching tabs always shows every pane of the tab; a pane
  maximized with Ctrl+Shift+E comes back unmaximized, at its sizes.
- **Reloads:** for now tabs last until the window reloads; bb then shows its
  own layout as one tab.

## When the strip is missing

- The window is phone-width (under 768 px) or has a touch pointer: bb has no
  split there, so the strip is hidden.
- The plugin is disabled, or a bb update moved the place the strip attaches to.

If a bb update changes how bb keeps its layout, clicking a tab may stop
switching; the browser console then shows a "[horizontal-tabs] could not show
the tab's layout" warning with the reason.

The plugin has no settings or commands yet.
