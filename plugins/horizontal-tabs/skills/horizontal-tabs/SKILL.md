---
name: horizontal-tabs
description: Explain the Horizontal Tabs plugin's tab strip at the top of bb's main panel. Use when the user asks what the strip or its tab shows, why the tab's title or project initials changed, why no tab is selected, or why the strip is missing.
---

# Horizontal Tabs

Horizontal Tabs adds one row across the top of bb's main panel, above every
pane, whether bb shows one thread or a split of several. Each pane keeps its own
header (title, menu, maximize, Close pane) just below the strip. The plugin is
experimental: a bb update may break it.

## What the strip shows

For now the strip holds one tab: the layout on screen.

- **Title:** the thread in the focused pane, the one the sidebar highlights.
  Hover the tab for the full title when it is cut short.
- **Project initials:** one coloured tile per project with a thread open in the
  layout, in pane order, coloured as in the Activity sidebar.
- **Selected:** the tab is selected on a thread. On Settings, a plugin page or
  bb's own New thread screen the strip stays and no tab is selected.

## When it changes

The tab follows bb. Clicking into another pane, opening a thread from the
sidebar, the palette or a link, and dragging a divider all update it. On the New
thread screen or a plugin page the tab keeps the last thread layout it showed.

## When the strip is missing

- The window is phone-width (under 768 px) or has a touch pointer: bb has no
  split there, so the strip is hidden.
- The plugin is disabled, or a bb update moved the place the strip attaches to.

The plugin has no settings or commands yet. Switching between several tabs is
not available yet.
