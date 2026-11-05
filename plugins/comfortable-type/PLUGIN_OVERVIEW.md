bb sets most desktop text at 13px. This plugin adds a **Comfortable Type** theme that raises bb's type scale one step, to the 14px body text T3 Code uses, sets it in your system font, and leaves every color as bb's default palette has it.

## What you get

- **14px text where you read.** Assistant replies, the composer, sidebar thread titles, and the thread header title move from 13px to 14px, with line heights to match.
- **The system font.** Text uses San Francisco on macOS, falling back to Inter, which bb bundles, elsewhere.
- **A taller header.** The thread header grows from 48px to 52px to fit the larger title.
- **bb's colors, unchanged.** The theme sets no color tokens, so light and dark mode look exactly as they do under bb's Default theme.
- **Phones untouched.** On a phone-sized touch screen, bb keeps its own font and touch scale, which is already larger.

Small labels and metadata stay at 12px, and the smallest text grows from 10px to 11px.

## How to use it

Pick **Comfortable Type** in **Settings → Appearance**, or run `bb theme set plugin:comfortable-type:comfortable`. Run `bb theme set default` to go back.

A theme takes bb's single palette slot, so this one cannot be combined with another palette such as Nord or Dracula: choosing either replaces the other.

## How it works

The theme is one stylesheet of CSS variables (font, text sizes, line heights, and header height). It adds no tools, settings, commands, or network access.
