---
name: horizontal-tabs
description: Explain the Horizontal Tabs plugin's tab strip at the top of bb's main panel, where each tab holds a whole split layout. Use when the user asks what a tab holds or shows, how to open, switch or close tabs, what clicking, middle-clicking or Cmd/Ctrl-clicking a thread in the sidebar does, what bb's next/previous thread and open thread N shortcuts do with tabs, why a thread is open in two tabs, how to switch tabs from the keyboard or change those shortcuts, why Ctrl+Tab does nothing in a browser, why a tab's title or project initials changed, why no tab is selected, why a maximized pane came back unmaximized, or why the strip is missing.
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
- **Open from the sidebar:** see below.
- **Switch from the keyboard:** see below.
- **Change what a tab holds** with bb as usual: open a thread from the sidebar,
  the palette or a link, split, drag a divider, close a pane. The tab on screen
  keeps whatever bb shows, and shows it again when you come back to it.

## Sidebar clicks

Clicking a thread in bb's thread list or in the Activity sidebar goes through
the tabs first:

| You click a thread that is… | Plain click | Middle-click |
|---|---|---|
| open in another tab | that tab, with the thread's pane focused | a new tab |
| open in the tab on screen | bb focuses its pane | a new tab |
| open in no tab | bb opens it in the focused pane, the other panes stay | a new tab |

- A new tab opens right of the tab on screen, holding that thread alone, and
  is selected. It opens even when another tab already has the thread, so the
  thread is then in both. A middle-click never opens a browser tab.
- If the thread is in more than one tab, a plain click goes to the tab on
  screen if it has the thread, else to the leftmost tab that has it.
- **Cmd-click (macOS) or Ctrl-click (Windows, Linux) stays bb's:** it opens
  the thread in a new split pane in the tab on screen, which keeps that split.
  If another tab has the thread, it is then in both tabs.
- Pressing Enter on a thread row you reached with the keyboard counts as a
  plain click.
- bb's Next thread, Previous thread and Open thread 1–9 shortcuts (Settings →
  Keyboard) open a sidebar row the way a plain click does, so they too go to
  the tab that has the thread. While the tab on screen is split, bb gives
  the Open thread keys to Focus chat pane 1–8 instead.
- Other clicks stay bb's: any click with Shift, Alt, Cmd or Ctrl held, the
  row's own buttons and menu (Archive, its actions, Open in split), every
  click while the strip is hidden, and a middle-click on an archived thread or
  before the sidebar has loaded its threads.
- Other ways of opening a thread aren't routed through the tabs: the palette,
  `@thread` links, `bb thread open` and the Activity hover card's Open. bb
  opens the thread as usual, which can put a thread in two tabs, and the tab
  on screen keeps what bb shows.

## Keyboard

| Command | Default shortcut |
|---|---|
| Next tab | Ctrl+Tab |
| Previous tab | Ctrl+Shift+Tab |
| Go to tab 1 … Go to tab 9 | Alt+1 … Alt+9 |

- Next and Previous wrap: Next on the last tab goes to the first.
- Go to tab N counts tabs from the left; Alt+9 is the ninth tab, not the last.
- The shortcuts are Ctrl and Alt on every platform, macOS included. They work
  while you type in the composer too.
- With no tab selected (Settings, a plugin page), Next and Previous count
  from the tab that was on screen last.
- The palette (Mod+Shift+P) lists them under Horizontal Tabs, only when they
  can do something: Next and Previous need a second tab, Go to tab N needs an
  Nth tab, and none are listed while the strip is hidden.
- **In a web browser, Ctrl+Tab and Ctrl+Shift+Tab never reach bb:** the
  browser keeps them to switch its own tabs. Alt+1 … Alt+9 work there, or
  rebind Next and Previous to keys the browser lets through.
- **Change a shortcut** in Settings → Keyboard, under Plugin commands: the
  rows read "Plugin: horizontal-tabs". Click a shortcut and press the new keys;
  the palette shows the new one. Reset puts the default back.

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

The plugin has no settings.
