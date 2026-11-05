---
name: comfortable-type
description: Turn the Comfortable Type theme on or off, which sets bb's text one step larger (14px) in the system font with bb's default colors. Use when the user finds bb's text too small or cramped, asks for larger text or a system font, or wants the change undone.
---

# Comfortable Type

The Comfortable Type plugin adds one bb theme, `plugin:comfortable-type:comfortable`.
It changes only type and the header height, never colors.

## What it changes

| Token | bb Default | Comfortable Type |
| --- | --- | --- |
| `--font-sans` | Inter | `-apple-system`, BlinkMacSystemFont, Inter, Segoe UI, system-ui |
| `--text-sm` (replies, composer, sidebar titles, header title) | 13px / 18.6px | 14px / 20px |
| `--text-base` | 15px / 22px | 16px / 24px |
| `--text-2xs` | 10px / 14px | 11px / 16px |
| `--text-xs` (labels, metadata) | 12px | 12px, unchanged |
| `--bb-app-chrome-row-height` (header) | 48px | 52px |

It also fixes one bb layout bug while active: in the macOS desktop window, the
close button on a right-panel tab no longer stretches into a tall strip on hover.

Phone-sized touch screens keep bb's own font and touch scale, which is already larger.

## Procedure

1. Run `bb theme show` and note the active theme, so you can tell the user
   what they had before.
2. Turn the theme on with `bb theme set plugin:comfortable-type:comfortable`.
   The change reaches every open bb window at once, with no reload.
3. To turn it off, run `bb theme set <previous-id>`, or `bb theme set default`
   when there was none.

## Rules

- A theme takes bb's single palette slot. Turning Comfortable Type on replaces a
  palette such as `nord` or `dracula`, and choosing one of those replaces
  Comfortable Type. Tell the user this before you switch away from a palette
  they chose.
- If `bb theme set` reports an unknown theme, the plugin is not loaded: run
  `bb theme list` and check the **Plugins** section.
