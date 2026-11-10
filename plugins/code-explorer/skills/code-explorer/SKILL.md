---
name: code-explorer
description: What the Code Explorer plugin changes in bb's chat (a colored file-type icon in front of file links and inside @file mention pills) and what it leaves alone.
---

# Code Explorer

The Code Explorer plugin puts a colored file-type icon in chat messages. It has
no tab, no CLI command, no agent tool, and no settings.

## What it changes

- **File links**: every link to a local file in a rendered message, such as
  `summary-text.tsx:40`, gets the file's icon in front of its name. The icon
  stays on the same line as the name when the link wraps.
- **`@file` mentions**: every file mention pill in a sent message shows the
  file's icon in place of bb's plain file glyph.

The icon is picked by the file's name: TypeScript, React, JSON, Markdown, CSS,
git, npm, images, and many more, each in its own color for light and dark mode.
`package.json` gets the npm icon and `tsconfig.json` the TypeScript icon.

## What it leaves alone

- Web links.
- Folder mentions, which keep bb's folder icon.
- Thread, skill, command and other non-file mentions.
- Pills still being typed in the composer, which keep bb's icon until the
  message is sent. The editable composer is skipped on purpose.

Disabling or removing the plugin removes the icons.
