Code Explorer puts a colored file-type icon in front of every file link and
`@file` mention in chat, so `app.tsx` reads as React and `README.md` as
Markdown at a glance.

## What you get

- **File links in messages**, such as `summary-text.tsx:40`, get the file's
  icon in front: React, TypeScript, Markdown, JSON, git, npm, images, and many
  more.
- **`@file` mention pills** in sent messages show the typed icon in place of
  bb's plain file glyph.
- **Everything else is left alone**: folder mentions keep bb's folder icon,
  thread, skill and command mentions don't change, and pills you are still
  typing in the composer keep bb's icon until the message is sent.
- **Follows your theme**: each icon type has its own color, tuned for light
  and dark mode.

## How it works

The icons are the colored icon set of `@pierre/trees`, the file tree T3 Code
uses, and ship inside the plugin; nothing is sent anywhere. The plugin watches
the page for new messages and adds the icons as they appear. Disabling or
removing it takes the icons away. There is nothing to configure.
